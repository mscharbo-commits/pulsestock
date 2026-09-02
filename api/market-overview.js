export const config = { runtime: 'edge' };

const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

const CG_KEY = process.env.COINGECKO_API_KEY || '';

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const headers = url.includes('coingecko.com')
      ? { 'x-cg-demo-api-key': CG_KEY, 'Accept': 'application/json' }
      : {};
    const r = await fetch(url, {signal:ctrl.signal, headers});
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
  {sym:'BTC-USD',name:'Bitcoin',disp:'BTC',cgId:'bitcoin'},
  {sym:'ETH-USD',name:'Ethereum',disp:'ETH',cgId:'ethereum'},
  {sym:'SOL-USD',name:'Solana',disp:'SOL',cgId:'solana'},
  {sym:'XRP-USD',name:'XRP',disp:'XRP',cgId:'ripple'},
  {sym:'AVAX-USD',name:'Avalanche',disp:'AVAX',cgId:'avalanche-2'},
  {sym:'DOGE-USD',name:'Dogecoin',disp:'DOGE',cgId:'dogecoin'},
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
    // /coins/markets — one call, returns price + pct + market cap for all coins
    const cgIds = CRYPTO_PAIRS.map(p => p.cgId).join(',');
    const markets = await sf(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgIds}&order=market_cap_desc&per_page=20&page=1&price_change_percentage=24h`, 8000);
    if (Array.isArray(markets)) {
      markets.forEach(coin => {
        const pair = CRYPTO_PAIRS.find(p => p.cgId === coin.id);
        if (pair) result[pair.sym] = {name:pair.name, disp:pair.disp, price:coin.current_price||0, pct:coin.price_change_percentage_24h||0, change:coin.price_change_24h||0};
      });
    }
    // Fetch trending coins
    const trending = await sf('https://api.coingecko.com/api/v3/search/trending', 6000);
    if (trending && trending.coins) {
      result._trending = trending.coins.slice(0, 7).map(c => ({
        id:    c.item.id,
        name:  c.item.name,
        sym:   c.item.symbol.toUpperCase(),
        thumb: c.item.thumb,
        pct:   c.item.data && c.item.data.price_change_percentage_24h && c.item.data.price_change_percentage_24h.usd || 0,
        price: c.item.data && c.item.data.price || null,
        spark: c.item.data && c.item.data.sparkline || null,
      }));
    }
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
