export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON   = process.env.POLYGON_API_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

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

// Calculate SMA from closes array (most recent first)
function sma(closes, period) {
  if(closes.length < period) return null;
  return closes.slice(0, period).reduce((a,b)=>a+b,0) / period;
}

// Calculate RSI from closes array (most recent first)
function rsi(closes, period=14) {
  if(closes.length < period+1) return null;
  const rev = [...closes].reverse(); // oldest first
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){
    const diff = rev[i]-rev[i-1];
    if(diff>0) gains+=diff; else losses+=Math.abs(diff);
  }
  const avgGain=gains/period, avgLoss=losses/period;
  if(avgLoss===0) return 100;
  const rs=avgGain/avgLoss;
  return 100-(100/(1+rs));
}

// Fetch Polygon candle data for a symbol (last N days)
async function getCandles(sym, days=55) {
  if(!POLYGON) return null;
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now()-days*86400000).toISOString().split('T')[0];
  const d = await sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${days}&apiKey=${POLYGON}`, 6000);
  return d?.results || null;
}

// Get technical snapshot for a symbol
async function getTechnicals(sym) {
  const candles = await getCandles(sym, 55);
  if(!candles || candles.length < 21) return null;
  const closes = candles.map(c=>c.c); // most recent first
  const currPrice = closes[0];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const vs20  = sma20 ? ((currPrice-sma20)/sma20*100) : null;
  const vs50  = sma50 ? ((currPrice-sma50)/sma50*100) : null;
  // Recent high/low (20-day)
  const high20 = Math.max(...candles.slice(0,20).map(c=>c.h));
  const low20  = Math.min(...candles.slice(0,20).map(c=>c.l));
  const pctFromHigh = ((currPrice-high20)/high20*100);
  const pctFromLow  = ((currPrice-low20)/low20*100);
  return {sym, price:currPrice, sma20, sma50, rsi14, vs20, vs50, high20, low20, pctFromHigh, pctFromLow};
}

// Build a plain-English technical sentence for a symbol
function techSentence(t) {
  if(!t) return null;
  const lines = [];
  const p = t.price.toFixed(2);

  // MA relationship
  if(t.vs20 !== null) {
    if(Math.abs(t.vs20) < 0.5) lines.push(`${t.sym} is testing its 20-day MA at $${t.sma20.toFixed(2)} — a key inflection point`);
    else if(t.vs20 > 0) lines.push(`${t.sym} is ${t.vs20.toFixed(1)}% above its 20-day MA ($${t.sma20.toFixed(2)})`);
    else lines.push(`${t.sym} is ${Math.abs(t.vs20).toFixed(1)}% below its 20-day MA ($${t.sma20.toFixed(2)})`);
  }
  if(t.sma50 !== null) {
    if(Math.abs(t.vs50) < 0.5) lines.push(`testing the 50-day at $${t.sma50.toFixed(2)}`);
    else if(t.vs50 > 3) lines.push(`well above its 50-day ($${t.sma50.toFixed(2)})`);
    else if(t.vs50 < -3) lines.push(`trading below the 50-day ($${t.sma50.toFixed(2)})`);
  }

  // RSI
  if(t.rsi14 !== null) {
    if(t.rsi14 > 70) lines.push(`RSI at ${t.rsi14.toFixed(0)} (overbought)`);
    else if(t.rsi14 < 30) lines.push(`RSI at ${t.rsi14.toFixed(0)} (oversold — watch for bounce)`);
    else if(t.rsi14 > 60) lines.push(`RSI ${t.rsi14.toFixed(0)} (momentum firm)`);
    else if(t.rsi14 < 45) lines.push(`RSI ${t.rsi14.toFixed(0)} (momentum fading)`);
  }

  // Range context
  if(t.pctFromHigh > -1.5) lines.push(`near 20-day highs`);
  else if(t.pctFromHigh < -8) lines.push(`${Math.abs(t.pctFromHigh).toFixed(1)}% off 20-day highs`);
  if(t.pctFromLow < 3) lines.push(`near 20-day lows — support watch`);

  return lines.length ? lines.join(', ') : null;
}

const MARKET_KEYWORDS = ['fed','federal reserve','fomc','rate','inflation','cpi','pce','jobs','gdp','payroll','earnings','revenue','profit','beat','miss','eps','guidance','outlook','forecast','yield','treasury','bond','rate cut','rate hike','interest rate','economic','economy','recession','growth','unemployment','retail sales','ism','pmi','manufacturing','housing','consumer','spending','rally','selloff','sell-off','plunge','surge','jump','drop','decline','gain','stocks','market','nasdaq','s&p','dow','equities','wall street','oil','gold','dollar','crypto','bitcoin','merger','acquisition','buyout','ipo','spinoff','apple','nvidia','microsoft','meta','tesla','amazon','google','alphabet','jpmorgan','semiconductor','ai','artificial intelligence','cloud','tech','tariff','trade','quarter','fiscal','annual','report','results'];
const GEO_NOISE = ['war','military','troops','soldier','attack','bomb','missile','ukraine','russia','israel','gaza','hamas','iran','north korea','election','vote','president','congress','senate','democrat','republican','political','crime','murder','shooting','arrest','police','court','trial','weather','hurricane','earthquake','flood','fire','tornado','celebrity','sports','entertainment','oscar','grammy','nfl','nba','mlb'];
function isMarketRelevant(h){const l=h.toLowerCase();return MARKET_KEYWORDS.some(k=>l.includes(k));}
function isGeoNoise(h){const l=h.toLowerCase();return GEO_NOISE.some(k=>l.includes(k));}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  if(_cache && Date.now()-_cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({..._cache, cached:true}),{headers:CORS});
  }

  const now = new Date();
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(),m=et.getMinutes(),dow=et.getDay();
  const isOpen    = dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const isPreMkt  = dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30));
  const isPostMkt = dow>=1&&dow<=5&&h>=16&&h<20;
  const session   = isOpen?'Market Open':isPreMkt?'Pre-Market':isPostMkt?'After Hours':'Market Closed';
  const timeStr   = et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  const PRICE_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV','XLI'];
  const TECH_SYMS  = ['SPY','QQQ','IWM','XLK','GLD','USO']; // key symbols for technicals

  const [quotes, generalNews, businessNews, ...techData] = await Promise.all([
    Promise.all(PRICE_SYMS.map(s=>sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`,5000),
    sf(`https://finnhub.io/api/v1/news?category=business&minId=0&token=${FINNHUB}`,5000),
    ...TECH_SYMS.map(s=>getTechnicals(s)),
  ]);

  const data = {};
  PRICE_SYMS.forEach((s,i)=>{
    const d=quotes[i];
    if(d&&(d.c||d.pc)) data[s]={price:d.c||d.pc,pct:d.dp||0,change:d.d||0};
  });

  // Build technical summary
  const techMap = {};
  TECH_SYMS.forEach((s,i)=>{ if(techData[i]) techMap[s]=techData[i]; });

  const techLines = TECH_SYMS
    .map(s=>techSentence(techMap[s]))
    .filter(Boolean);

  const techSummary = techLines.length
    ? techLines.map(l=>`• ${l}`).join('\n')
    : 'Technical data unavailable.';

  // Filter news
  const sixHoursAgo = Math.floor(Date.now()/1000)-(6*3600);
  const allNews = [...(generalNews||[]),...(businessNews||[])]
    .filter(n=>n.datetime>sixHoursAgo&&!isGeoNoise(n.headline)&&isMarketRelevant(n.headline))
    .sort((a,b)=>b.datetime-a.datetime).slice(0,6);

  const headlines = allNews.length ? allNews.map(n=>`• ${n.headline}`).join('\n') : 'No major economic catalysts in the last 6 hours.';

  function fmt(s){
    const d=data[s];
    if(!d) return `${s}: N/A`;
    return `${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`;
  }

  const priceSummary=[
    `Indexes: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VIX: ${data.VIX?data.VIX.price.toFixed(1):'N/A'} | Bonds: ${fmt('TLT')}`,
    `Mega-caps: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')}`,
    `Sectors: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Fins ${fmt('XLF')} | Health ${fmt('XLV')} | Ind ${fmt('XLI')}`,
  ].join('\n');

  let narrative = 'Market data loaded.';

  if(ANTHROPIC) {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:450,
        system:`You are a senior market analyst writing a real-time market pulse for professional traders.
Write exactly 5 sentences structured as follows:
1. Macro theme: The dominant market narrative today and the key economic/earnings catalyst driving it.
2. Sector rotation: What is leading, what is lagging, and why — connect to the catalyst.
3. Top mover: The biggest individual stock move and its specific catalyst.
4. Technical picture: Weave in the technical levels provided — MAs, RSI, support/resistance. Make it specific and actionable (e.g. "QQQ is testing its 20-day MA at $712 with RSI at 44 — a close below opens the door to $695").
5. Watch item: One specific level, catalyst, or dynamic to monitor for the rest of the session.
Rules: Use exact numbers from the data. Never split a decimal number. Active voice. No disclaimers. Sharp and direct.`,
        messages:[{role:'user',content:`Session: ${session} | ${timeStr}

PRICE ACTION:
${priceSummary}

TECHNICAL LEVELS (calculated from daily candles):
${techSummary}

ECONOMIC & EARNINGS CATALYSTS (last 6 hours):
${headlines}

Write the 5-sentence market pulse narrative.`}]
      })
    });
    if(aiResp.ok){
      const aiData=await aiResp.json();
      narrative=aiData.content?.[0]?.text||narrative;
    }
  }

  const result={narrative,data,session,isOpen,timeStr,technicals:techMap};
  _cache=result;
  _cacheTime=Date.now();

  return new Response(JSON.stringify(result),{headers:CORS});
}
