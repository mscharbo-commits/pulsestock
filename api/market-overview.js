export const config = { runtime: 'edge' };

const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

// Using ETFs as commodity proxies - labeled clearly
// GLD tracks gold at ~1/10th oz price, multiply by 10 for approximate spot
// USO tracks WTI crude but is NOT 1:1 - use as directional indicator only
const INDEX_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT'];

// Commodity ETFs with scaling factors and actual labels
const COMMOD_CONFIG = [
  {sym:'GLD',  label:'Gold',        unit:'ETF', note:'GLD ETF'},
  {sym:'SLV',  label:'Silver',      unit:'ETF', note:'SLV ETF'},
  {sym:'USO',  label:'WTI Crude',   unit:'ETF', note:'USO ETF'},
  {sym:'UNG',  label:'Natural Gas', unit:'ETF', note:'UNG ETF'},
  {sym:'CPER', label:'Copper',      unit:'ETF', note:'CPER ETF'},
  {sym:'WEAT', label:'Wheat',       unit:'ETF', note:'WEAT ETF'},
];

const CRYPTO_PAIRS = [
  {sym:'BTC-USD', name:'Bitcoin',   disp:'BTC'},
  {sym:'ETH-USD', name:'Ethereum',  disp:'ETH'},
  {sym:'SOL-USD', name:'Solana',    disp:'SOL'},
  {sym:'XRP-USD', name:'XRP',       disp:'XRP'},
  {sym:'AVAX-USD',name:'Avalanche', disp:'AVAX'},
  {sym:'DOGE-USD',name:'Dogecoin',  disp:'DOGE'},
];

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const tab = searchParams.get('tab') || 'indexes';
  let result = {};

  if(tab === 'crypto') {
    const quotes = await Promise.all(
      CRYPTO_PAIRS.map(p => sf(
        `https://api.polygon.io/v2/aggs/ticker/X:${p.sym.replace('-','')}USD/prev?adjusted=true&apiKey=${POLYGON}`, 5000
      ))
    );
    CRYPTO_PAIRS.forEach(function(p, i) {
      const r = quotes[i]?.results?.[0];
      if(r && r.c) {
        result[p.sym] = {
          name: p.name, disp: p.disp,
          price: r.c,
          pct: r.o ? ((r.c - r.o) / r.o * 100) : 0,
          change: r.o ? (r.c - r.o) : 0,
        };
      }
    });
  } else if(tab === 'commodities') {
    const syms = COMMOD_CONFIG.map(c => c.sym);
    const quotes = await Promise.all(
      syms.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`, 4000))
    );
    COMMOD_CONFIG.forEach(function(cfg, i) {
      const d = quotes[i];
      if(d && (d.c || d.pc)) {
        const price = d.c || d.pc;
        result[cfg.sym] = {
          price,
          pct: d.dp || 0,
          change: d.d || 0,
          prevClose: d.pc || 0,
          label: cfg.label,
          note: cfg.note,
        };
      }
    });
  } else {
    // Indexes
    const quotes = await Promise.all(
      INDEX_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`, 4000))
    );
    INDEX_SYMS.forEach(function(sym, i) {
      const d = quotes[i];
      if(d && (d.c || d.pc)) {
        result[sym] = {price: d.c||d.pc, pct: d.dp||0, change: d.d||0, prevClose: d.pc||0};
      }
    });
  }

  return new Response(JSON.stringify(result), {headers:CORS});
}
