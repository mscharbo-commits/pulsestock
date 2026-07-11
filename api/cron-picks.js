export const config = { maxDuration: 120 };

const POLYGON    = process.env.POLYGON_API_KEY || '';
const FINNHUB    = process.env.FINNHUB_KEY || '';
const GIST_TOKEN = process.env.GITHUB_TOKEN || '';
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

// Core universe — 12 high-quality liquid stocks across sectors
// These will be supplemented by news-driven movers on trading days
const CORE = [
  'NVDA','META','AAPL','MSFT','AMZN',  // Tech/Mega-cap
  'JPM','GS',                            // Financials
  'XOM','CVX',                           // Energy
  'LLY','UNH',                           // Healthcare
  'TSLA',                                // High-vol consumer
];

async function sf(url, t=8000) {
  try {
    const ctrl=new AbortController(), id=setTimeout(()=>ctrl.abort(),t);
    const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(id);
    if(!r.ok) return null; return await r.json();
  } catch(e){ return null; }
}

function lastTradingDate() {
  const d = new Date();
  const et = new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));
  while(et.getDay()===0||et.getDay()===6) et.setDate(et.getDate()-1);
  if(et.getHours()<9||(et.getHours()===9&&et.getMinutes()<30)) et.setDate(et.getDate()-1);
  while(et.getDay()===0||et.getDay()===6) et.setDate(et.getDate()-1);
  return et.toISOString().split('T')[0];
}

async function getMacro() {
  const [spy,vix,tlt] = await Promise.all([
    sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/quote?symbol=TLT&token=${FINNHUB}`,4000),
  ]);
  return {
    spyPct: (spy?.dp||0).toFixed(2),
    vix:    (vix?.c||20).toFixed(1),
    tltPct: (tlt?.dp||0).toFixed(2),
    riskOn: (spy?.dp||0)>0 && (vix?.c||20)<22,
  };
}

// Get top movers from Polygon to add to core universe
async function getTopMovers() {
  const date = lastTradingDate();
  const grouped = await sf(
    `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON}`,
    12000
  );
  if(!grouped?.results?.length) return [];

  const coreSet = new Set(CORE);
  return grouped.results
    .filter(s =>
      !coreSet.has(s.T) &&        // not already in core
      /^[A-Z]{1,5}$/.test(s.T) && // clean ticker
      s.v >= 2e6 &&                // liquid
      s.c >= 10 &&                 // $10+
      Math.abs(s.o?((s.c-s.o)/s.o*100):0) >= 2 // moved 2%+
    )
    .map(s => ({
      sym: s.T,
      pct: s.o ? ((s.c-s.o)/s.o*100) : 0,
      volume: s.v,
    }))
    .sort((a,b) => Math.abs(b.pct)-Math.abs(a.pct))
    .slice(0,3) // top 3 movers
    .map(s => s.sym);
}

async function analyzeStock(sym, host) {
  const url = `https://${host}/api/picks-analyze?ticker=${sym}&type=general`;
  const result = await sf(url, 15000);
  if(result?.rating) return result;
  return null;
}

async function saveToGist(data) {
  const r = await fetch(`https://api.github.com/gists/${PICKS_GIST}`, {
    method:'PATCH',
    headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
    body: JSON.stringify({files:{'enhanced_picks.json':{content:JSON.stringify(data)}}})
  });
  return r.ok;
}

function buildPickTypes(results, macro) {
  const ratingOrder = {BUY:0,WATCH:1,AVOID:2};
  const byScore = [...results].sort((a,b) => {
    const ro = (ratingOrder[a.rating]||1)-(ratingOrder[b.rating]||1);
    return ro!==0 ? ro : (b.score||50)-(a.score||50);
  });
  const byMom   = [...results].sort((a,b) => (b.pct||0)-(a.pct||0));
  const byVol   = [...results].sort((a,b) => (b.volume||0)-(a.volume||0));

  // Sector grouping
  function sectorGroup(arr) {
    const g = {};
    arr.forEach(s => {
      const sec = s.sector||'Unknown';
      if(!g[sec]) g[sec]=[];
      if(g[sec].length<5) g[sec].push({
        sym:s.sym, name:s.name||s.sym,
        price:s.price||0, pct:s.pct||0,
        score:s.score||50, rating:s.rating||'WATCH',
        reasons:s.keySignals||[],
      });
    });
    return g;
  }

  function pickList(arr) {
    return arr.slice(0,5).map(s=>({
      sym:s.sym, name:s.name||s.sym, sector:s.sector||'',
      price:s.price||0, pct:s.pct||0, score:s.score||50,
      rating:s.rating||'WATCH',
      rsi:s.rsi?parseFloat(s.rsi).toFixed(0):null,
      above50MA:s.sma50?(s.price||0)>s.sma50:null,
      above200MA:s.sma200?(s.price||0)>s.sma200:null,
      sma50:s.sma50?s.sma50.toFixed(2):null,
      sma200:s.sma200?s.sma200.toFixed(2):null,
      reasons:s.keySignals||[],
      thesis:s.thesis||null,
      target:s.target||null,
      stopLoss:s.stopLoss||null,
      timeframe:s.timeframe||null,
    }));
  }

  return {
    general:  {label:'Best Opportunity',  icon:'🎯', overall:pickList(byScore),  bySector:sectorGroup(byScore),  totalAnalyzed:results.length},
    growth:   {label:'Long-Term Growth',  icon:'🌱', overall:pickList(byScore.filter(s=>s.rating==='BUY')), bySector:sectorGroup(byScore), totalAnalyzed:results.length},
    momentum: {label:'Momentum / Swing',  icon:'🚀', overall:pickList(byMom),   bySector:sectorGroup(byMom),   totalAnalyzed:results.length},
    intraday: {label:'Intraday',          icon:'⚡', overall:pickList(byVol),   bySector:sectorGroup(byVol),   totalAnalyzed:results.length},
  };
}

export default async function handler(req, res) {
  const send = (status, body) => { res.writeHead(status,CORS); res.end(JSON.stringify(body)); };
  if(req.method==='OPTIONS') return send(200,{});

  const secret   = req.query?.secret||'';
  const runType  = req.query?.run||'full';
  const provided = (req.headers?.authorization||'').replace('Bearer ','')||secret;
  const valid    = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401,{error:'Unauthorized'});

  const host = req.headers?.host || 'pulsestock-nu.vercel.app';

  try {
    console.log('[picks] Starting', runType, '| host:', host);

    // Step 1: macro + top movers in parallel (fast)
    const [macro, topMovers] = await Promise.all([getMacro(), getTopMovers()]);
    console.log('[picks] Macro: SPY', macro.spyPct, '% | Movers:', topMovers.join(','));

    // Step 2: build final universe (core + movers, max 15)
    const universe = [...new Set([...CORE, ...topMovers])].slice(0,15);
    console.log('[picks] Universe:', universe.join(','));

    // Step 3: analyze ALL stocks in parallel (picks-analyze handles its own rate limiting)
    console.log('[picks] Analyzing', universe.length, 'stocks in parallel...');
    const results = await Promise.all(
      universe.map(sym => analyzeStock(sym, host).catch(()=>null))
    );
    const analyzed = results.filter(Boolean);
    console.log('[picks]', analyzed.length, 'stocks analyzed successfully');

    if(!analyzed.length) return send(500,{error:'No analysis results — check picks-analyze'});

    // Step 4: build pick types and save
    const pickTypes = buildPickTypes(analyzed, macro);

    const output = {
      generated: new Date().toISOString(),
      runType, macro,
      universe: universe.length,
      analyzed: analyzed.length,
      pickTypes,
    };

    console.log('[picks] Saving to Gist...');
    const saved = await saveToGist(output);
    console.log('[picks] Gist save:', saved ? 'OK' : 'FAILED');

    return send(200, {
      success:true, runType, macro, saved,
      analyzed: analyzed.length,
      counts: Object.fromEntries(Object.entries(pickTypes).map(([k,v])=>[k,v.overall.length]))
    });

  } catch(e) {
    console.error('[picks] Fatal:', e.message);
    return send(500,{error:e.message});
  }
}
