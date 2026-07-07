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

const INDEX_SYMS  = ['SPY','QQQ','DIA','IWM','VIX','TLT'];
const COMMOD_SYMS = ['GLD','SLV','USO','UNG','CPER','WEAT'];
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
    // Polygon crypto - use individual quotes for reliability
    const quotes = await Promise.all(
      CRYPTO_PAIRS.map(p => sf(`https://api.polygon.io/v2/aggs/ticker/X:${p.sym.replace('-','')}/prev?adjusted=true&apiKey=${POLYGON}`, 5000))
    );
    CRYPTO_PAIRS.forEach(function(p, i) {
      const d = quotes[i];
      const r = d?.results?.[0];
      if(r) {
        result[p.sym] = {
          name: p.name,
          disp: p.disp,
          price: r.c || 0,
          open:  r.o || 0,
          pct: r.o ? ((r.c - r.o) / r.o * 100) : 0,
          change: r.o ? (r.c - r.o) : 0,
          vol: r.v || 0
        };
      }
    });
  } else {
    const syms = tab === 'indexes' ? INDEX_SYMS : COMMOD_SYMS;
    const quotes = await Promise.all(
      syms.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`, 4000))
    );
    syms.forEach(function(sym, i) {
      const d = quotes[i];
      if(d) {
        const price = d.c || d.pc || 0;
        result[sym] = {price, pct: d.dp||0, change: d.d||0, prevClose: d.pc||0};
      }
    });
  }

  return new Response(JSON.stringify(result), {headers:CORS});
}
