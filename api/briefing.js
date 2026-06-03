export const config = { runtime: 'edge' };
const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
async function getQuote(symbol) { try { const r = await fetch('https://finnhub.io/api/v1/quote?symbol='+symbol+'&token='+FINNHUB_KEY); const d = await r.json(); return { symbol, price: d.c, change: d.d, pct: d.dp }; } catch(e) { return { symbol, price: 0, change: 0, pct: 0 }; } }
async function getEarnings() { try { const today = new Date().toISOString().split('T')[0]; const tom = new Date(Date.now()+86400000).toISOString().split('T')[0]; const r = await fetch('https://finnhub.io/api/v1/calendar/earnings?from='+today+'&to='+tom+'&token='+FINNHUB_KEY); const d = await r.json(); return (d.earningsCalendar||[]).slice(0,10); } catch(e) { return []; } }
async function getNews() { try { const r = await fetch('https://finnhub.io/api/v1/news?category=general&minId=0&token='+FINNHUB_KEY); const d = await r.json(); return (d||[]).slice(0,8); } catch(e) { return []; } }
async function getEcon() { try { const today = new Date().toISOString().split('T')[0]; const tom = new Date(Date.now()+86400000).toISOString().split('T')[0]; const r = await fetch('https://finnhub.io/api/v1/calendar/economic?from='+today+'&to='+tom+'&token='+FINNHUB_KEY); const d = await r.json(); return (d.economicCalendar||[]).slice(0,8); } catch(e) { return []; } }
async function getMacro() {
  const commodities = [{sym:'USO',label:'Crude Oil',icon:'🛢️'},{sym:'GLD',label:'Gold',icon:'🥇'},{sym:'SLV',label:'Silver',icon:'🥈'},{sym:'UNG',label:'Nat Gas',icon:'⚡'},{sym:'WEAT',label:'Wheat',icon:'🌾'},{sym:'CORN',label:'Corn',icon:'🌽'},{sym:'SOYB',label:'Soybeans',icon:'🫘'},{sym:'DBO',label:'Brent Oil',icon:'🛢️'}];
  const fx = [{sym:'UUP',label:'USD Index',icon:'💵'},{sym:'FXE',label:'EUR/USD',icon:'💶'},{sym:'FXY',label:'JPY',icon:'💴'},{sym:'FXB',label:'GBP',icon:'💷'},{sym:'FXA',label:'AUD',icon:'🦘'},{sym:'BTC-USD',label:'Bitcoin',icon:'₿'},{sym:'ETH-USD',label:'Ethereum',icon:'⟠'}];
  const global = [{sym:'EWJ',label:'Japan',icon:'🇯🇵'},{sym:'EWG',label:'Germany',icon:'🇩🇪'},{sym:'EWU',label:'UK',icon:'🇬🇧'},{sym:'EWC',label:'Canada',icon:'🇨🇦'},{sym:'MCHI',label:'China',icon:'🇨🇳'},{sym:'EWZ',label:'Brazil',icon:'🇧🇷'},{sym:'INDA',label:'India',icon:'🇮🇳'},{sym:'EWA',label:'Australia',icon:'🇦🇺'}];
  const all = [...commodities,...fx,...global];
  const results = await Promise.all(all.map(async s => { const q = await getQuote(s.sym); return {...s,...q}; }));
  return { commodities: results.slice(0,commodities.length), fx: results.slice(commodities.length,commodities.length+fx.length), global: results.slice(commodities.length+fx.length) };
}
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url); const type = url.searchParams.get('type') || 'pre';
  const indices = ['SPY','QQQ','DIA','IWM','VIX'];
  const sectors = ['XLK','XLF','XLE','XLV','XLI','XLC','XLY','XLP','XLU','XLRE'];
  const watchlist = ['AAPL','NVDA','MSFT','TSLA','AMZN','META','GOOGL','JPM','AMD','NFLX'];
  const sectorNames = {XLK:'Technology',XLF:'Financials',XLE:'Energy',XLV:'Healthcare',XLI:'Industrials',XLC:'Communication',XLY:'Consumer Disc.',XLP:'Consumer Staples',XLU:'Utilities',XLRE:'Real Estate'};
  const [indicesData,sectorsData,watchlistData,earnings,news,economic,macro] = await Promise.all([Promise.all(indices.map(getQuote)),Promise.all(sectors.map(getQuote)),Promise.all(watchlist.map(getQuote)),getEarnings(),getNews(),getEcon(),getMacro()]);
  const sorted = [...watchlistData].sort((a,b) => Math.abs(b.pct)-Math.abs(a.pct));
  const sortedSectors = [...sectorsData].sort((a,b) => b.pct-a.pct).map(s => ({...s,name:sectorNames[s.symbol]||s.symbol}));
  return new Response(JSON.stringify({ type, timestamp: new Date().toISOString(), indices: indicesData, sectors: sortedSectors, gainers: sorted.filter(s=>s.pct>0).slice(0,5), losers: sorted.filter(s=>s.pct<0).slice(0,5), earnings, news, economic, commodities: macro.commodities, fx: macro.fx, global: macro.global }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
