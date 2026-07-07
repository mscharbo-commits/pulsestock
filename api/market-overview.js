export const config = { runtime: 'edge' };

const FINNHUB  = process.env.FINNHUB_KEY  || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON  = process.env.POLYGON_API_KEY || '';
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

const INDEX_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT'];
const COMMOD_SYMS = ['GLD','SLV','USO','UNG','CPER','WEAT'];
const CRYPTO_SYMS = ['X:BTCUSD','X:ETHUSD','X:SOLUSD','X:XRPUSD','X:AVAXUSD','X:DOGEUSD'];

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const tab = searchParams.get('tab') || 'indexes';

  let result = {};

  if(tab === 'crypto') {
    if(!POLYGON) return new Response(JSON.stringify({error:'No Polygon key'}),{status:500,headers:CORS});
    // Batch crypto snapshot
    const syms = CRYPTO_SYMS.join(',');
    const data = await sf(`https://api.polygon.io/v2/snapshot/locale/global/markets/crypto/tickers?tickers=${encodeURIComponent(syms)}&apiKey=${POLYGON}`);
    if(data?.tickers) {
      data.tickers.forEach(function(t) {
        const price = t.day?.c || t.prevDay?.c || 0;
        const prev  = t.prevDay?.c || 0;
        const pct   = prev ? ((price-prev)/prev*100) : 0;
        result[t.ticker] = {price, pct, change: price-prev};
      });
    }
  } else {
    // Indexes or Commodities - use Finnhub batch quote
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
