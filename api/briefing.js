export const config = { runtime: 'edge' };
const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
async function getQuote(symbol) { try { const r = await fetch('https://finnhub.io/api/v1/quote?symbol='+symbol+'&token='+FINNHUB_KEY); const d = await r.json(); return { symbol, price: d.c, change: d.d, pct: d.dp, high: d.h, low: d.l }; } catch(e) { return { symbol, price: 0, change: 0, pct: 0 }; } }
async function getEarnings() { try { const today = new Date().toISOString().split('T')[0]; const tom = new Date(Date.now()+86400000).toISOString().split('T')[0]; const r = await fetch('https://finnhub.io/api/v1/calendar/earnings?from='+today+'&to='+tom+'&token='+FINNHUB_KEY); const d = await r.json(); return (d.earningsCalendar||[]).slice(0,10); } catch(e) { return []; } }
async function getNews() { try { const r = await fetch('https://finnhub.io/api/v1/news?category=general&minId=0&token='+FINNHUB_KEY); const d = await r.json(); return (d||[]).slice(0,8); } catch(e) { return []; } }
async function getEcon() { try { const today = new Date().toISOString().split('T')[0]; const tom = new Date(Date.now()+86400000).toISOString().split('T')[0]; const r = await fetch('https://finnhub.io/api/v1/calendar/economic?from='+today+'&to='+tom+'&token='+FINNHUB_KEY); const d = await r.json(); return (d.economicCalendar||[]).slice(0,8); } catch(e) { return []; } }
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url); const type = url.searchParams.get('type') || 'pre';
  const indices = ['SPY','QQQ','DIA','IWM','VIX'];
  const sectors = ['XLK','XLF','XLE','XLV','XLI','XLC','XLY','XLP','XLU','XLRE'];
  const watchlist = ['AAPL','NVDA','MSFT','TSLA','AMZN','META','GOOGL','JPM','AMD','NFLX'];
  const sectorNames = {XLK:'Technology',XLF:'Financials',XLE:'Energy',XLV:'Healthcare',XLI:'Industrials',XLC:'Communication',XLY:'Consumer Disc.',XLP:'Consumer Staples',XLU:'Utilities',XLRE:'Real Estate'};
  const [indicesData,sectorsData,watchlistData,earnings,news,economic] = await Promise.all([Promise.all(indices.map(getQuote)),Promise.all(sectors.map(getQuote)),Promise.all(watchlist.map(getQuote)),getEarnings(),getNews(),getEcon()]);
  const sorted = [...watchlistData].sort((a,b) => Math.abs(b.pct)-Math.abs(a.pct));
  const sortedSectors = [...sectorsData].sort((a,b) => b.pct-a.pct).map(s => ({...s,name:sectorNames[s.symbol]||s.symbol}));
  return new Response(JSON.stringify({ type, timestamp: new Date().toISOString(), indices: indicesData, sectors: sortedSectors, gainers: sorted.filter(s=>s.pct>0).slice(0,5), losers: sorted.filter(s=>s.pct<0).slice(0,5), earnings, news, economic }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
