export const config = { maxDuration: 300 };

const POLYGON    = process.env.POLYGON_API_KEY || '';
const FINNHUB    = process.env.FINNHUB_KEY || '';
const GIST_TOKEN = process.env.GITHUB_TOKEN || process.env.GIST_TOKEN || '';
const REPO = 'mscharbo-commits/pulsestock';
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

// S&P 500 tickers — full universe
// On trading days Polygon grouped aggs gives us ALL of these in one call
// On weekends we fall back to this list for snapshot
const SP500_CORE = [
  // Mega-cap tech
  'AAPL','MSFT','NVDA','GOOGL','GOOG','META','AMZN','TSLA','AVGO','AMD',
  'INTC','CRM','ADBE','ORCL','CSCO','ACN','IBM','TXN','QCOM','NOW',
  // Financials
  'JPM','BAC','WFC','GS','MS','C','BLK','AXP','V','MA','SPGI','MCO',
  // Healthcare
  'LLY','UNH','JNJ','ABBV','MRK','PFE','TMO','ABT','DHR','ISRG','AMGN',
  // Energy
  'XOM','CVX','COP','SLB','EOG','PXD','MPC','PSX','VLO','OXY',
  // Consumer
  'WMT','COST','HD','MCD','SBUX','NKE','TGT','LOW','CMG','YUM','DG',
  // Industrials
  'CAT','DE','RTX','HON','BA','GE','UPS','FDX','LMT','NOC','EMR',
  // Communication
  'NFLX','DIS','CMCSA','T','VZ','TMUS','PARA','WBD','EA','TTWO',
  // Real Estate & Utilities
  'NEE','DUK','SO','D','AMT','PLD','EQIX','CCI','SPG','O',
  // Materials
  'LIN','APD','ECL','SHW','FCX','NEM','ALB','CF','MOS',
  // High-momentum / high-vol additions
  'PLTR','PANW','SNOW','UBER','ABNB','COIN','MSTR','SMCI','ARM','HOOD',
  'RIVN','LCID','SOFI','AFRM','UPST','OPEN','RBLX','SNAP','PINS','U',
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

// STAGE 1: Get full universe data in ONE Polygon call
async function getUniverseData() {
  const date = lastTradingDate();
  console.log('[picks] Fetching full universe for', date);

  // Try grouped aggs first (most data)
  const grouped = await sf(
    `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON}`,
    20000
  );

  if(grouped?.results?.length > 100) {
    const tickerSet = new Set(SP500_CORE);
    const universe = grouped.results
      .filter(s => tickerSet.has(s.T) && s.c > 0)
      .map(s => ({
        sym:    s.T,
        price:  s.c,
        open:   s.o,
        high:   s.h,
        low:    s.l,
        volume: s.v,
        vwap:   s.vw,
        pct:    s.o ? ((s.c - s.o) / s.o * 100) : 0,
      }));
    console.log(`[picks] Grouped aggs: ${universe.length} stocks found`);
    return universe;
  }

  // Fallback: Polygon snapshot for our list
  console.log('[picks] Grouped empty — trying snapshot');
  const tickers = SP500_CORE.join(',');
  const snap = await sf(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${POLYGON}`,
    15000
  );

  if(snap?.tickers?.length) {
    return snap.tickers.map(t => ({
      sym:    t.ticker,
      price:  t.day?.c || t.prevDay?.c || 0,
      open:   t.day?.o || t.prevDay?.o || 0,
      high:   t.day?.h || t.prevDay?.h || 0,
      low:    t.day?.l || t.prevDay?.l || 0,
      volume: t.day?.v || t.prevDay?.v || 0,
      vwap:   t.day?.vw || t.prevDay?.vw || 0,
      pct:    t.todaysChangePerc || 0,
    })).filter(s => s.price > 0);
  }

  // Last resort: return full list with zeros — picks-analyze will get live prices
  console.log('[picks] Both empty — using fallback with zero prices');
  return SP500_CORE.map(sym => ({sym, price:0, open:0, high:0, low:0, volume:0, vwap:0, pct:0}));
}

// STAGE 2: Filter universe to best candidates (no API calls)
function filterCandidates(universe, runType) {
  if(!universe.length) return [];

  // Sort candidates by multiple signals
  const scored = universe.map(s => {
    let score = 0;

    // Absolute momentum — stocks moving are more interesting
    const absPct = Math.abs(s.pct);
    if(absPct > 5)       score += 30;
    else if(absPct > 3)  score += 20;
    else if(absPct > 1.5)score += 12;
    else if(absPct > 0.5)score += 5;

    // Direction — prefer positive for general/growth/momentum
    if(s.pct > 0) score += 8;

    // Volume matters
    if(s.volume > 50e6) score += 15;
    else if(s.volume > 20e6) score += 10;
    else if(s.volume > 5e6)  score += 5;
    else if(s.volume < 500000 && s.volume > 0) score -= 10; // illiquid

    // Price filter
    if(s.price > 0 && s.price < 5) score -= 20;

    return {...s, filterScore: score};
  });

  // Check if we have real price data
  const hasRealData = universe.some(s => s.price > 0 && s.pct !== 0);

  let candidates;
  if(!hasRealData) {
    // Weekend/no-data fallback: use blue chips in order, picks-analyze gets live prices
    console.log('[picks] No price data — using ordered blue chip list');
    candidates = universe.slice(0, 40);
  } else {
    // We have real data — filter by momentum and volume
    const topMovers = scored
      .filter(s => Math.abs(s.pct) >= 1.0 || s.volume > 5e6)
      .sort((a,b) => b.filterScore - a.filterScore)
      .slice(0, 35);

    // Add high-quality blue chips if we have room
    const blueChips = ['AAPL','MSFT','NVDA','META','GOOGL','AMZN','JPM','LLY','XOM','TSLA'];
    const topSyms = new Set(topMovers.map(s=>s.sym));
    const extras = universe
      .filter(s => blueChips.includes(s.sym) && !topSyms.has(s.sym))
      .slice(0, 10);

    candidates = [...topMovers, ...extras];
  }
  console.log(`[picks] Filtered to ${candidates.length} candidates from ${universe.length} universe`);
  return candidates;
}

// STAGE 3: AI analysis on candidates
async function analyzeCandidate(sym, host) {
  const url = `https://${host}/api/picks-analyze?ticker=${sym}&type=general`;
  const r = await sf(url, 15000);
  return (r && r.rating) ? r : null;
}

// Build structured pick types from analyzed results
function buildOutput(results, macro, runType) {
  if(!results.length) return null;

  const ratingOrder = {BUY:0,WATCH:1,AVOID:2};

  function sortFn(type) {
    return (a,b) => {
      const ro = (ratingOrder[a.rating]||1)-(ratingOrder[b.rating]||1);
      if(ro!==0) return ro;
      if(type==='momentum') return (b.pct||0)-(a.pct||0);
      if(type==='intraday') return (b.volume||0)-(a.volume||0);
      return (b.score||50)-(a.score||50);
    };
  }

  function pickList(arr, type) {
    // Only BUY picks in top picks — shorts tab shows AVOID only
    const filtered = type==='shorts'
      ? arr.filter(s=>s.rating==='AVOID').sort((a,b)=>(a.score||50)-(b.score||50))
      : arr.filter(s=>s.rating==='BUY');
    return [...filtered].sort(sortFn(type)).slice(0,5).map(s=>({
      sym:s.sym||s.ticker, name:s.name||s.sym||s.ticker, sector:s.sector||'',
      price:s.price||0, pct:s.pct||0, score:s.score||50,
      rating:s.rating||'WATCH',
      rsi:s.rsi?parseFloat(s.rsi).toFixed(0):null,
      above50MA:s.sma50?(s.price||0)>s.sma50:null,
      above200MA:s.sma200?(s.price||0)>s.sma200:null,
      sma50:s.sma50?s.sma50.toFixed(2):null,
      sma200:s.sma200?s.sma200.toFixed(2):null,
      reasons:s.keySignals||[], thesis:s.thesis||null,
      target:s.target||null, stopLoss:s.stopLoss||null, timeframe:s.timeframe||null,
    }));
  }

  function bySectorMap(arr, type) {
    const g = {};
    const filtered = type==='shorts'
      ? arr.filter(s=>s.rating==='AVOID')
      : arr.filter(s=>s.rating==='BUY');
    [...filtered].sort(sortFn(type)).forEach(s => {
      const sec = s.sector||'Unknown';
      if(!g[sec]) g[sec]=[];
      if(g[sec].length<5) g[sec].push({
        sym:s.sym||s.ticker, name:s.name||s.sym||s.ticker,
        price:s.price||0, pct:s.pct||0,
        score:s.score||50, rating:s.rating||'WATCH',
        reasons:s.keySignals||[],
      });
    });
    return g;
  }

  const TYPES = {
    general:  {label:'Best Opportunity', icon:'🎯'},
    growth:   {label:'Long-Term Growth', icon:'🌱'},
    momentum: {label:'Momentum / Swing', icon:'🚀'},
    intraday: {label:'Intraday',         icon:'⚡'},
    shorts:   {label:'Short Watch',      icon:'🐻'},
  };

  const pickTypes = {};
  Object.entries(TYPES).forEach(([type,meta]) => {
    pickTypes[type] = {
      ...meta,
      overall:       pickList(results, type),
      bySector:      bySectorMap(results, type),
      totalAnalyzed: results.length,
      totalBuy:      results.filter(s=>s.rating==='BUY').length,
    };
  });

  return {
    generated:  new Date().toISOString(),
    runType, macro,
    universeSize: SP500_CORE.length,
    analyzed:     results.length,
    pickTypes,
  };
}

export default async function handler(req, res) {
  const send = (s,b)=>{ res.writeHead(s,CORS); res.end(JSON.stringify(b)); };
  if(req.method==='OPTIONS') return send(200,{});

  const secret   = req.query?.secret||'';
  const runType  = req.query?.run||'full';
  const provided = (req.headers?.authorization||'').replace('Bearer ','')||secret;
  const valid    = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401,{error:'Unauthorized'});

  const host = req.headers?.host||'pulsestock-nu.vercel.app';
  const startTime = Date.now();

  try {
    console.log('[picks] ===== Starting', runType, 'scan =====');

    // Macro + universe in parallel
    const [spyQ,vixQ,tltQ,universe] = await Promise.all([
      sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`,4000),
      sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`,4000),
      sf(`https://finnhub.io/api/v1/quote?symbol=TLT&token=${FINNHUB}`,4000),
      getUniverseData(),
    ]);

    const macro = {
      spyPct: (spyQ?.dp||0).toFixed(2),
      vix:    (vixQ?.c||20).toFixed(1),
      tltPct: (tltQ?.dp||0).toFixed(2),
      riskOn: (spyQ?.dp||0)>0 && (vixQ?.c||20)<22,
    };
    console.log('[picks] Macro: SPY', macro.spyPct, '% | VIX', macro.vix);

    // Filter to candidates
    const candidates = filterCandidates(universe, runType);
    if(!candidates.length) return send(500,{error:'No candidates after filtering'});

    // Analyze in parallel batches of 5 with delay to avoid Finnhub rate limits
    const results = [];
    const batchSize = 5;

    for(let i=0; i<candidates.length; i+=batchSize) {
      const batch = candidates.slice(i, i+batchSize);
      const elapsed = ((Date.now()-startTime)/1000).toFixed(0);
      console.log(`[picks] Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(candidates.length/batchSize)} | ${elapsed}s elapsed`);

      const batchResults = await Promise.all(
        batch.map(s => analyzeCandidate(s.sym, host).catch(()=>null))
      );
      // Filter out SKIP (no price data) and nulls
      const valid = batchResults.filter(r => r && r.rating && r.rating !== 'SKIP');
      results.push(...valid);

      // Small delay between batches to avoid Finnhub rate limits
      if(i+batchSize < candidates.length) await new Promise(r=>setTimeout(r,800));

      // Stop if running out of time
      if(Date.now()-startTime > 200000) {
        console.log('[picks] Time limit — stopping with', results.length, 'results');
        break;
      }
    }

    console.log(`[picks] Total analyzed: ${results.length} | Time: ${((Date.now()-startTime)/1000).toFixed(0)}s`);

    if(!results.length) return send(500,{error:'No analysis results'});

    const output = buildOutput(results, macro, runType);

    // Save to repo file (picks-data.json)
    const saveStart = Date.now();
    let saved = false;
    try {
      const encoded = Buffer.from(JSON.stringify(output)).toString('base64');
      // Get current sha
      let fileSha = '';
      const gfr = await fetch('https://api.github.com/repos/mscharbo-commits/pulsestock/contents/picks-data.json',
        {headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'User-Agent':'PulseStock'}});
      if(gfr.ok) { const gfd = await gfr.json(); fileSha = gfd.sha||''; }
      const body = {message:'Update picks-data.json', content:encoded};
      if(fileSha) body.sha = fileSha;
      const gr = await fetch('https://api.github.com/repos/mscharbo-commits/pulsestock/contents/picks-data.json', {
        method:'PUT',
        headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
        body: JSON.stringify(body)
      });
      saved = gr.ok;
      console.log(`[picks] Repo save: ${gr.status} | ${((Date.now()-saveStart)/1000).toFixed(1)}s`);
    } catch(e) { console.error('[picks] Save error:', e.message); }

    const totalTime = ((Date.now()-startTime)/1000).toFixed(0);
    console.log(`[picks] ===== Complete in ${totalTime}s =====`);

    return send(200,{
      success: true, runType, macro,
      universeSize: universe.length,
      candidates:   candidates.length,
      analyzed:     results.length,
      repoSaved: saved,
      elapsedSeconds: totalTime,
      counts: Object.fromEntries(
        Object.entries(output.pickTypes).map(([k,v])=>[k,v.overall.length])
      )
    });

  } catch(e) {
    console.error('[picks] Fatal:', e.message, '| Stack:', e.stack?.slice(0,200));
    return send(500,{error:e.message});
  }
}
