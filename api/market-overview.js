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
const SECTOR_SYMS = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
const COMMOD_SYMS = ['GLD','SLV','USO','UNG','CPER','WEAT'];
const LIVE_SYMS   = ['SPY','QQQ','DIA','IWM','VIX','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM'];
const CRYPTO_PAIRS = [
  {sym:'BTC-USD',name:'Bitcoin',disp:'BTC'},
  {sym:'ETH-USD',name:'Ethereum',disp:'ETH'},
  {sym:'SOL-USD',name:'Solana',disp:'SOL'},
  {sym:'XRP-USD',name:'XRP',disp:'XRP'},
  {sym:'AVAX-USD',name:'Avalanche',disp:'AVAX'},
  {sym:'DOGE-USD',name:'Dogecoin',disp:'DOGE'},
];
const SECTOR_NAMES = {
  XLK:'Technology',XLF:'Financials',XLE:'Energy',XLV:'Healthcare',
  XLI:'Industrials',XLY:'Consumer Disc.',XLP:'Consumer Staples',
  XLU:'Utilities',XLRE:'Real Estate',XLC:'Communication',XLB:'Materials'
};

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const tab = searchParams.get('tab') || 'indexes';
  let result = {};

  if(tab === 'crypto') {
    const quotes = await Promise.all(
      CRYPTO_PAIRS.map(p => sf(`https://api.polygon.io/v2/aggs/ticker/X:${p.sym.replace('-','')}USD/prev?adjusted=true&apiKey=${POLYGON}`,5000))
    );
    CRYPTO_PAIRS.forEach((p,i) => {
      const r = quotes[i]?.results?.[0];
      if(r && r.c) result[p.sym] = {name:p.name,disp:p.disp,price:r.c,pct:r.o?((r.c-r.o)/r.o*100):0,change:r.o?(r.c-r.o):0};
    });
  } else if(tab === 'sectors') {
    const quotes = await Promise.all(SECTOR_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));
    SECTOR_SYMS.forEach((sym,i) => {
      const d = quotes[i];
      if(d && (d.c||d.pc)) result[sym] = {price:d.c||d.pc,pct:d.dp||0,change:d.d||0,prevClose:d.pc||0,name:SECTOR_NAMES[sym]||sym};
    });
  } else if(tab === 'live') {
    const quotes = await Promise.all(LIVE_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));
    LIVE_SYMS.forEach((sym,i) => {
      const d = quotes[i];
      if(d && (d.c||d.pc)) result[sym] = {price:d.c||d.pc,pct:d.dp||0,change:d.d||0,prevClose:d.pc||0};
    });
    // Market status
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
    const h = et.getHours(), m = et.getMinutes(), dow = et.getDay();
    result._market = {
      isOpen: dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16,
      time: et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'})+' ET'
    };
  } else if(tab === 'commodities') {
    const quotes = await Promise.all(COMMOD_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));
    COMMOD_SYMS.forEach((sym,i) => {
      const d = quotes[i];
      if(d&&(d.c||d.pc)) result[sym] = {price:d.c||d.pc,pct:d.dp||0,change:d.d||0,prevClose:d.pc||0};
    });
  } else {
    // indexes
    const quotes = await Promise.all(INDEX_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));
    INDEX_SYMS.forEach((sym,i) => {
      const d = quotes[i];
      if(d&&(d.c||d.pc)) result[sym] = {price:d.c||d.pc,pct:d.dp||0,change:d.d||0,prevClose:d.pc||0};
    });
  }

  return new Response(JSON.stringify(result),{headers:CORS});
}
