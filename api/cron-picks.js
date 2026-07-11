export const config = { maxDuration: 60 };

const POLYGON    = process.env.POLYGON_API_KEY || '';
const FINNHUB    = process.env.FINNHUB_KEY || '';
const GIST_TOKEN = process.env.GITHUB_TOKEN || '';
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

// Top S&P 500 tickers for universe
const TOP_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','JPM','V','UNH',
  'XOM','CVX','LLY','JNJ','ABBV','HD','PG','MA','MRK','PEP',
  'COST','KO','BAC','WMT','AVGO','TMO','CSCO','ACN','ABT','CRM',
  'MCD','ADBE','PFE','DIS','NFLX','AMD','INTC','GS','MS','CAT',
  'DE','RTX','HON','BA','GE','LMT','UPS','WFC','ISRG','NOW',
  'PANW','UBER','ABNB','SNOW','PLTR','ARM','SMCI','MSTR','HOOD','RIVN'
];

async function sf(url, t=6000) {
  try {
    const ctrl=new AbortController(), id=setTimeout(()=>ctrl.abort(),t);
    const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(id);
    if(!r.ok) return null; return await r.json();
  } catch(e){ return null; }
}

// Get snapshot for all tickers in one Polygon call
async function getSnapshot(tickers) {
  const snap = await sf(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}&apiKey=${POLYGON}`,
    10000
  );
  if(!snap?.tickers) return [];
  return snap.tickers.map(t=>({
    sym:   t.ticker,
    price: t.day?.c || t.prevDay?.c || 0,
    pct:   t.todaysChangePerc || 0,
    volume:t.day?.v || t.prevDay?.v || 0,
    vwap:  t.day?.vw || t.prevDay?.vw || 0,
  })).filter(s=>s.price>1);
}

// Quick rank by momentum + volume (no API calls)
function quickRank(stocks) {
  return stocks.map(s=>{
    let score = 50;
    if(s.pct>3)        score+=20;
    else if(s.pct>1.5) score+=12;
    else if(s.pct>0.5) score+=6;
    else if(s.pct<-2)  score-=8;
    if(s.volume>50e6)  score+=10;
    else if(s.volume>10e6) score+=5;
    return {...s, quickScore:score};
  }).sort((a,b)=>b.quickScore-a.quickScore);
}

// Call our picks-analyze endpoint for each ticker
async function analyzeTicker(sym, pickType, host) {
  const url = `https://${host}/api/picks-analyze?ticker=${sym}&type=${pickType}`;
  return await sf(url, 15000);
}

export default async function handler(req, res) {
  const send = (status, body) => {
    res.writeHead(status, CORS);
    res.end(JSON.stringify(body));
  };

  if(req.method==='OPTIONS') return send(200,{});

  const secret   = req.query?.secret || '';
  const runType  = req.query?.run || 'full';
  const provided = (req.headers?.authorization||'').replace('Bearer ','')||secret;
  const valid    = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401,{error:'Unauthorized'});

  const host = req.headers?.host || 'pulsestock-nu.vercel.app';

  try {
    console.log('[picks] Starting', runType, 'on', host);

    // Macro
    const [spyQ, vixQ] = await Promise.all([
      sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`,4000),
      sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`,4000),
    ]);
    const macro = {
      spyPct: (spyQ?.dp||0).toFixed(2),
      vix:    (vixQ?.c||20).toFixed(1),
      tltPct: '0',
      riskOn: (spyQ?.dp||0)>0 && (vixQ?.c||20)<22,
    };

    // Get universe snapshot (1 Polygon call)
    const snapshot = await getSnapshot(TOP_TICKERS);
    console.log(`[picks] Snapshot: ${snapshot.length} stocks`);

    // Quick rank — pick top 12 candidates
    const ranked = quickRank(snapshot).slice(0, 12);
    console.log(`[picks] Top candidates: ${ranked.slice(0,5).map(s=>s.sym+'('+s.pct.toFixed(1)+'%)').join(', ')}`);

    // Run AI deep analysis on top 12, 3 at a time
    const PICK_TYPES = ['general','growth','momentum','intraday'];
    const allAnalyzed = {};

    // Analyze each ticker once (general type) then rescore for each type
    const analyzed = [];
    for(let i=0; i<ranked.length; i+=3) {
      const batch = ranked.slice(i,i+3);
      const results = await Promise.all(
        batch.map(s => analyzeTicker(s.sym, 'general', host).catch(()=>null))
      );
      results.forEach((r,idx)=>{ if(r&&r.rating) analyzed.push({...batch[idx],...r}); });
      if(i+3<ranked.length) await new Promise(r=>setTimeout(r,500));
    }
    console.log(`[picks] Analyzed: ${analyzed.length} stocks`);

    // For each pick type, re-rank the analyzed results
    const pickTypes = {};
    const icons   = {growth:'🌱',momentum:'🚀',intraday:'⚡',general:'🎯'};
    const labels  = {growth:'Long-Term Growth',momentum:'Momentum / Swing',intraday:'Intraday',general:'Best Opportunity'};

    for(const pt of PICK_TYPES) {
      // Re-run analysis for pick-type specific scoring for top 3
      const typeAnalyzed = [];
      const top3 = analyzed.slice(0,3);
      for(const s of top3) {
        const r = await analyzeTicker(s.sym, pt, host).catch(()=>null);
        if(r&&r.rating) typeAnalyzed.push({...s,...r});
        else typeAnalyzed.push(s);
      }
      // Append rest with general scores
      const rest = analyzed.slice(3).map(s=>({...s}));
      const allForType = [...typeAnalyzed, ...rest];

      // Sort: BUY first, then by score
      const ratingOrder = {BUY:0,WATCH:1,AVOID:2};
      allForType.sort((a,b)=>(ratingOrder[a.rating]||1)-(ratingOrder[b.rating]||1)||(b.score||50)-(a.score||50));

      const overall = allForType.slice(0,5);

      // Group by sector
      const bySector = {};
      for(const s of allForType) {
        const sec = s.sector||'Unknown';
        if(!bySector[sec]) bySector[sec]=[];
        if(bySector[sec].length<5) bySector[sec].push(s);
      }

      pickTypes[pt] = {
        label: labels[pt], icon: icons[pt],
        overall: overall.map(s=>({
          sym:       s.sym,
          name:      s.name||s.sym,
          sector:    s.sector||'',
          price:     s.price,
          pct:       s.pct,
          score:     s.score||50,
          rating:    s.rating||'WATCH',
          rsi:       s.rsi ? parseFloat(s.rsi).toFixed(0) : null,
          above50MA: s.sma50  ? s.price > s.sma50  : null,
          above200MA:s.sma200 ? s.price > s.sma200 : null,
          sma50:     s.sma50  ? s.sma50.toFixed(2)  : null,
          sma200:    s.sma200 ? s.sma200.toFixed(2) : null,
          reasons:   s.keySignals||[],
          thesis:    s.thesis||null,
          target:    s.target||null,
          stopLoss:  s.stopLoss||null,
          timeframe: s.timeframe||null,
          headlines: [],
        })),
        bySector: Object.fromEntries(
          Object.entries(bySector).map(([sec,stocks])=>[sec,
            stocks.map(s=>({sym:s.sym,name:s.name||s.sym,price:s.price,pct:s.pct,score:s.score||50,reasons:s.keySignals||[]}))
          ])
        ),
        totalQualified: allForType.filter(s=>s.rating==='BUY').length,
      };
    }

    const output = {generated:new Date().toISOString(), runType, macro, pickTypes};

    // Save to Gist
    const gr = await fetch(`https://api.github.com/gists/${PICKS_GIST}`,{
      method:'PATCH',
      headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
      body: JSON.stringify({files:{'enhanced_picks.json':{content:JSON.stringify(output)}}})
    });
    console.log('[picks] Gist saved:', gr.status);

    return send(200,{success:true,runType,macro,
      summary:{snapshot:snapshot.length, analyzed:analyzed.length,
        counts:Object.fromEntries(PICK_TYPES.map(k=>[k,pickTypes[k].overall.length]))}
    });

  } catch(e) {
    console.error('[picks] Fatal:', e.message);
    return send(500,{error:e.message});
  }
}
