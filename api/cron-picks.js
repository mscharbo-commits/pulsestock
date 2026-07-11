export const config = { maxDuration: 300 };

const POLYGON    = process.env.POLYGON_API_KEY || '';
const FINNHUB    = process.env.FINNHUB_KEY || '';
const GIST_TOKEN = process.env.GITHUB_TOKEN || '';
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET || '';
const BASE_URL   = 'https://pulsestock-nu.vercel.app';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

const UNIVERSE = [
  // Mega cap tech
  'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','AVGO','AMD',
  // Financials
  'JPM','GS','MS','BAC','V','MA',
  // Healthcare
  'LLY','JNJ','UNH','ABBV','MRK',
  // Energy
  'XOM','CVX','OXY',
  // Industrials
  'CAT','DE','GE','BA','RTX',
  // Consumer
  'HD','WMT','MCD','COST','NKE',
  // Communication
  'NFLX','DIS','CMCSA',
  // Other high-volume
  'CRM','NOW','PANW','PLTR','UBER'
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
  // Go back until we hit Mon-Fri
  while(et.getDay()===0||et.getDay()===6) et.setDate(et.getDate()-1);
  // If before market open go back one more day
  if(et.getHours()<9||(et.getHours()===9&&et.getMinutes()<30)) et.setDate(et.getDate()-1);
  while(et.getDay()===0||et.getDay()===6) et.setDate(et.getDate()-1);
  return et.toISOString().split('T')[0];
}

async function getMarketData() {
  // Get prev day data for all universe stocks in ONE Polygon call
  const date = lastTradingDate();
  console.log('[picks] Fetching grouped aggs for', date);
  const grouped = await sf(
    `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON}`,
    15000
  );

  const tickerSet = new Set(UNIVERSE);
  const byTicker = {};

  if(grouped?.results) {
    grouped.results.forEach(s => {
      if(tickerSet.has(s.T)) {
        byTicker[s.T] = {
          sym: s.T,
          price: s.c,
          open:  s.o,
          high:  s.h,
          low:   s.l,
          volume:s.v,
          vwap:  s.vw,
          pct:   s.o ? ((s.c-s.o)/s.o*100) : 0,
        };
      }
    });
  }

  // For any missing, fill with 0 so they still get analyzed
  UNIVERSE.forEach(sym => {
    if(!byTicker[sym]) byTicker[sym] = {sym, price:0, open:0, high:0, low:0, volume:0, vwap:0, pct:0};
  });

  return byTicker;
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

async function analyzeStock(sym, type) {
  const r = await sf(`${BASE_URL}/api/picks-analyze?ticker=${sym}&type=${type}`, 12000);
  return r;
}

async function saveToGist(data) {
  try {
    await fetch(`https://api.github.com/gists/${PICKS_GIST}`, {
      method:'PATCH',
      headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
      body: JSON.stringify({files:{'enhanced_picks.json':{content:JSON.stringify(data)}}})
    });
  } catch(e) { console.error('[picks] Gist save error:', e.message); }
}

export default async function handler(req, res) {
  const send = (status, body) => { res.writeHead(status,CORS); res.end(JSON.stringify(body)); };
  if(req.method==='OPTIONS') return send(200,{});

  const secret   = req.query?.secret||'';
  const runType  = req.query?.run||'full';
  const provided = (req.headers?.authorization||'').replace('Bearer ','')||secret;
  const valid    = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401,{error:'Unauthorized'});

  try {
    console.log('[picks] Starting run:', runType);
    const [marketData, macro] = await Promise.all([getMarketData(), getMacro()]);
    console.log(`[picks] Got data for ${Object.keys(marketData).length} stocks`);

    const PICK_TYPES = ['general','growth','momentum','intraday'];
    const icons   = {growth:'🌱',momentum:'🚀',intraday:'⚡',general:'🎯'};
    const labels  = {growth:'Long-Term Growth',momentum:'Momentum / Swing',intraday:'Intraday',general:'Best Opportunity'};
    const descs   = {
      growth:   'Quality companies with durable competitive advantages and multi-year growth runways',
      momentum: 'Strong price momentum and technical setups for 5-30 day swing trades',
      intraday: 'High-liquidity stocks with fresh catalysts for same-day trades',
      general:  'Best overall risk-adjusted opportunities today across all timeframes',
    };

    // Analyze all stocks for 'general' type in parallel batches of 5
    const symbols = UNIVERSE;
    const generalResults = {};

    console.log(`[picks] Analyzing ${symbols.length} stocks...`);
    for(let i=0; i<symbols.length; i+=5) {
      const batch = symbols.slice(i,i+5);
      const results = await Promise.all(
        batch.map(sym => analyzeStock(sym, 'general').catch(()=>null))
      );
      results.forEach((r,idx) => {
        if(r&&r.rating) {
          generalResults[batch[idx]] = {...marketData[batch[idx]], ...r};
        }
      });
      console.log(`[picks] Batch ${Math.floor(i/5)+1}/${Math.ceil(symbols.length/5)} done`);
      // Small delay between batches
      if(i+5<symbols.length) await new Promise(r=>setTimeout(r,300));
    }

    console.log(`[picks] ${Object.keys(generalResults).length} stocks analyzed`);

    // Build pick types from general results, re-ranking by type criteria
    const pickTypes = {};
    const allAnalyzed = Object.values(generalResults);

    for(const pt of PICK_TYPES) {
      // Sort based on pick type priorities
      const sorted = allAnalyzed.slice().sort((a,b) => {
        const ratingOrder = {BUY:0,WATCH:1,AVOID:2};
        const ro = (ratingOrder[a.rating]||1) - (ratingOrder[b.rating]||1);
        if(ro!==0) return ro;

        // Type-specific secondary sort
        if(pt==='momentum') return (b.pct||0)-(a.pct||0);
        if(pt==='intraday') return (b.volume||0)-(a.volume||0);
        if(pt==='growth')   return (b.score||50)-(a.score||50);
        return (b.score||50)-(a.score||50);
      });

      // Top 5 overall
      const overall = sorted.slice(0,5);

      // Group by sector
      const bySector = {};
      sorted.forEach(s => {
        const sec = s.sector||'Unknown';
        if(!bySector[sec]) bySector[sec]=[];
        if(bySector[sec].length<5) bySector[sec].push(s);
      });

      pickTypes[pt] = {
        label:labels[pt], icon:icons[pt], desc:descs[pt],
        overall: overall.map(s=>({
          sym:       s.sym,
          name:      s.name||s.sym,
          sector:    s.sector||'',
          price:     s.price||0,
          pct:       s.pct||0,
          score:     s.score||50,
          rating:    s.rating||'WATCH',
          rsi:       s.rsi?parseFloat(s.rsi).toFixed(0):null,
          above50MA: s.sma50  ? (s.price||0)>s.sma50  : null,
          above200MA:s.sma200 ? (s.price||0)>s.sma200 : null,
          sma50:     s.sma50  ? s.sma50.toFixed(2)  : null,
          sma200:    s.sma200 ? s.sma200.toFixed(2) : null,
          reasons:   s.keySignals||[],
          thesis:    s.thesis||null,
          target:    s.target||null,
          stopLoss:  s.stopLoss||null,
          timeframe: s.timeframe||null,
        })),
        bySector: Object.fromEntries(
          Object.entries(bySector).map(([sec,stocks])=>[sec,
            stocks.map(s=>({
              sym:s.sym, name:s.name||s.sym,
              price:s.price||0, pct:s.pct||0,
              score:s.score||50, rating:s.rating||'WATCH',
              reasons:s.keySignals||[],
            }))
          ])
        ),
        totalBuy: sorted.filter(s=>s.rating==='BUY').length,
        totalAnalyzed: sorted.length,
      };
    }

    const output = {
      generated: new Date().toISOString(),
      runType, macro,
      universe: symbols.length,
      analyzed: Object.keys(generalResults).length,
      pickTypes,
    };

    await saveToGist(output);
    console.log('[picks] Complete — saved to Gist');

    return send(200,{
      success:true, runType, macro,
      analyzed: Object.keys(generalResults).length,
      counts: Object.fromEntries(PICK_TYPES.map(k=>[k, pickTypes[k].overall.length]))
    });

  } catch(e) {
    console.error('[picks] Fatal:', e.message);
    return send(500,{error:e.message});
  }
}
