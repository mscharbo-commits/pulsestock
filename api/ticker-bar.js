export const config = { runtime: 'edge' };
const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

let _cache = null;
let _cacheTime = 0;
const TTL = 60 * 1000; // 60 second cache

async function sf(url, t=4000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  // Return cache if fresh
  if(_cache && Date.now()-_cacheTime < TTL) {
    return new Response(JSON.stringify({..._cache, cached:true}), {headers:CORS});
  }

  // Get symbols from query or use defaults
  const {searchParams} = new URL(req.url);
  const symsParam = searchParams.get('syms') || 'AAPL,NVDA,MSFT,META,TSLA,AMZN,GOOGL,JPM,SPY,QQQ,DIA,IWM,GLD,USO,BTC-USD,ETH-USD';
  const syms = symsParam.split(',').slice(0, 20); // cap at 20

  const quotes = await Promise.all(
    syms.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`, 4000))
  );

  const result = {};
  syms.forEach((s, i) => {
    const d = quotes[i];
    if(d && (d.c || d.pc)) {
      result[s] = {price: d.c||d.pc, change: d.d||0, pct: d.dp||0};
    }
  });

  _cache = result;
  _cacheTime = Date.now();

  return new Response(JSON.stringify(result), {headers:CORS});
}
