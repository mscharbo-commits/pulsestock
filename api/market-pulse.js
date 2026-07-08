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

// ── TECHNICAL CALCULATIONS ─────────────────────────────────────────────────
function sma(closes, period) {
  if(closes.length < period) return null;
  return closes.slice(0,period).reduce((a,b)=>a+b,0)/period;
}

function ema(closes, period) {
  if(closes.length < period) return null;
  const rev = [...closes].reverse();
  const k = 2/(period+1);
  let val = rev.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<rev.length;i++) val = rev[i]*k + val*(1-k);
  return val;
}

function rsi(closes, period=14) {
  if(closes.length < period+1) return null;
  const rev = [...closes].reverse();
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){
    const diff=rev[i]-rev[i-1];
    if(diff>0) gains+=diff; else losses+=Math.abs(diff);
  }
  const avgG=gains/period, avgL=losses/period;
  if(avgL===0) return 100;
  return 100-(100/(1+avgG/avgL));
}

function macd(closes, fast=12, slow=26, signal=9) {
  if(closes.length < slow+signal) return null;
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  if(!fastEma||!slowEma) return null;
  const macdLine = fastEma - slowEma;
  // Signal line = EMA of MACD (approximate with last N values)
  // For simplicity return macdLine and direction vs zero
  return { macdLine, bullish: macdLine > 0 };
}

async function getCandles(sym, days=210) {
  if(!POLYGON) return null;
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now()-days*86400000).toISOString().split('T')[0];
  const d = await sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${days}&apiKey=${POLYGON}`,6000);
  return d?.results || null;
}

async function getTechnicals(sym) {
  const candles = await getCandles(sym, 210);
  if(!candles || candles.length < 55) return null;
  const closes  = candles.map(c=>c.c); // most recent first
  const volumes = candles.map(c=>c.v);
  const curr    = closes[0];

  const sma20  = sma(closes, 20);
  const sma50  = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14  = rsi(closes, 14);
  const macdData = macd(closes);

  const vs20   = sma20  ? ((curr-sma20)/sma20*100)   : null;
  const vs50   = sma50  ? ((curr-sma50)/sma50*100)   : null;
  const vs200  = sma200 ? ((curr-sma200)/sma200*100) : null;

  // Volume analysis — compare today vs 20-day avg
  const avgVol20  = sma(volumes, 20);
  const todayVol  = volumes[0];
  const volRatio  = avgVol20 ? (todayVol/avgVol20) : null;

  // 20-day range
  const high20 = Math.max(...candles.slice(0,20).map(c=>c.h));
  const low20  = Math.min(...candles.slice(0,20).map(c=>c.l));
  const pctFromHigh = ((curr-high20)/high20*100);
  const pctFromLow  = ((curr-low20)/low20*100);

  // 52-week range
  const high52 = Math.max(...candles.slice(0,252).map(c=>c.h));
  const low52  = Math.min(...candles.slice(0,252).map(c=>c.l));
  const pct52High = ((curr-high52)/high52*100);

  return {
    sym, price:curr,
    sma20, sma50, sma200,
    vs20, vs50, vs200,
    rsi14, macd:macdData,
    volRatio, todayVol, avgVol20,
    high20, low20, high52, low52,
    pctFromHigh, pctFromLow, pct52High
  };
}

function techNarrative(t) {
  if(!t) return null;
  const lines = [];
  const sym = t.sym;

  // 200-day MA — most important institutional level
  if(t.vs200 !== null) {
    if(Math.abs(t.vs200) < 1) lines.push(`${sym} is sitting right on its 200-day MA at $${t.sma200.toFixed(2)} — major inflection`);
    else if(t.vs200 > 0) lines.push(`${sym} holds ${t.vs200.toFixed(1)}% above its 200-day MA ($${t.sma200.toFixed(2)}), bull trend intact`);
    else lines.push(`${sym} is ${Math.abs(t.vs200).toFixed(1)}% below its 200-day MA ($${t.sma200.toFixed(2)}) — bearish structure`);
  }

  // 20-day MA — short-term momentum
  if(t.vs20 !== null) {
    if(Math.abs(t.vs20) < 0.5) lines.push(`${sym} testing 20-day MA at $${t.sma20.toFixed(2)} — watch closely`);
    else if(t.vs20 > 0) lines.push(`${sym} +${t.vs20.toFixed(1)}% above 20-day ($${t.sma20.toFixed(2)})`);
    else lines.push(`${sym} ${t.vs20.toFixed(1)}% below 20-day ($${t.sma20.toFixed(2)}) — momentum fading`);
  }

  // RSI
  if(t.rsi14 !== null) {
    if(t.rsi14 > 75)      lines.push(`RSI ${t.rsi14.toFixed(0)} — significantly overbought, watch for pullback`);
    else if(t.rsi14 > 65) lines.push(`RSI ${t.rsi14.toFixed(0)} — momentum firm but getting stretched`);
    else if(t.rsi14 < 25) lines.push(`RSI ${t.rsi14.toFixed(0)} — deeply oversold, bounce potential`);
    else if(t.rsi14 < 35) lines.push(`RSI ${t.rsi14.toFixed(0)} — oversold, watching for stabilization`);
    else if(t.rsi14 > 45 && t.rsi14 < 55) lines.push(`RSI ${t.rsi14.toFixed(0)} — neutral momentum`);
  }

  // MACD
  if(t.macd) {
    if(t.macd.bullish && t.macd.macdLine > 0) lines.push(`MACD positive — momentum trending higher`);
    else if(!t.macd.bullish) lines.push(`MACD negative — momentum under pressure`);
  }

  // Volume context
  if(t.volRatio !== null) {
    if(t.volRatio > 1.5) lines.push(`volume running ${(t.volRatio).toFixed(1)}x above average — conviction behind the move`);
    else if(t.volRatio < 0.6) lines.push(`volume ${Math.round((1-t.volRatio)*100)}% below average — weak conviction`);
  }

  // 52-week context
  if(t.pct52High > -2)       lines.push(`${sym} near 52-week highs`);
  else if(t.pct52High < -20) lines.push(`${sym} ${Math.abs(t.pct52High).toFixed(0)}% off 52-week highs`);

  return lines.length ? lines.join('; ') : null;
}

// ── NEWS FILTERS ──────────────────────────────────────────────────────────
const MKT_KW = ['fed','federal reserve','fomc','rate','inflation','cpi','pce','jobs','gdp','payroll','earnings','revenue','profit','beat','miss','eps','guidance','outlook','forecast','yield','treasury','bond','rate cut','rate hike','interest rate','economic','economy','recession','growth','unemployment','retail sales','ism','pmi','manufacturing','housing','consumer','spending','rally','selloff','sell-off','plunge','surge','jump','drop','decline','gain','stocks','market','nasdaq','s&p','dow','equities','wall street','oil','gold','dollar','crypto','bitcoin','merger','acquisition','buyout','ipo','apple','nvidia','microsoft','meta','tesla','amazon','google','alphabet','jpmorgan','semiconductor','ai','artificial intelligence','cloud','tech','tariff','trade','quarter','fiscal','annual','report','results'];
const GEO_KW = ['war','military','troops','soldier','attack','bomb','missile','ukraine','russia','israel','gaza','hamas','iran','north korea','election','vote','president','congress','senate','democrat','republican','crime','murder','shooting','arrest','police','court','trial','weather','hurricane','earthquake','flood','fire','tornado','celebrity','entertainment','oscar','grammy','nfl','nba','mlb'];
const mktRel = h => { const l=h.toLowerCase(); return MKT_KW.some(k=>l.includes(k)); };
const geoNoise = h => { const l=h.toLowerCase(); return GEO_KW.some(k=>l.includes(k)); };

// ── BREADTH from sector ETFs ──────────────────────────────────────────────
function calcBreadth(data) {
  const sectors = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const up = sectors.filter(s=>data[s]&&data[s].pct>0).length;
  const total = sectors.filter(s=>data[s]).length;
  return {up, total, pct: total ? Math.round(up/total*100) : null};
}

// ── SENTIMENT SCORE (0-100) ───────────────────────────────────────────────
function calcSentiment(data, spyTech) {
  let score = 50, factors = 0;
  if(data.SPY)  { score += data.SPY.pct > 0 ? Math.min(data.SPY.pct*3,10) : Math.max(data.SPY.pct*3,-10); factors++; }
  if(data.VIX)  { const vix=data.VIX.price; score += vix<15?10:vix<20?5:vix<25?0:vix<30?-8:-15; factors++; }
  if(spyTech?.vs200 !== null && spyTech?.vs200 !== undefined) { score += spyTech.vs200>0?8:-8; factors++; }
  if(spyTech?.rsi14) { const r=spyTech.rsi14; score += r>60?5:r<40?-5:0; factors++; }
  const breadth = calcBreadth(data);
  if(breadth.pct!==null) { score += breadth.pct>70?8:breadth.pct>50?3:breadth.pct<30?-8:-3; factors++; }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  if(_cache && Date.now()-_cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({..._cache,cached:true}),{headers:CORS});
  }

  const now = new Date();
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(),m=et.getMinutes(),dow=et.getDay();
  const isOpen    = dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const isPreMkt  = dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30));
  const isPostMkt = dow>=1&&dow<=5&&h>=16&&h<20;
  const session   = isOpen?'Market Open':isPreMkt?'Pre-Market':isPostMkt?'After Hours':'Market Closed';
  const timeStr   = et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  const PRICE_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT','SHY','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const TECH_SYMS  = ['SPY','QQQ','IWM','XLK','GLD','USO'];

  const [quotes, genNews, bizNews, ...techResults] = await Promise.all([
    Promise.all(PRICE_SYMS.map(s=>sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`,5000),
    sf(`https://finnhub.io/api/v1/news?category=business&minId=0&token=${FINNHUB}`,5000),
    ...TECH_SYMS.map(s=>getTechnicals(s)),
  ]);

  const data = {};
  PRICE_SYMS.forEach((s,i)=>{ const d=quotes[i]; if(d&&(d.c||d.pc)) data[s]={price:d.c||d.pc,pct:d.dp||0,change:d.d||0}; });

  const techMap = {};
  TECH_SYMS.forEach((s,i)=>{ if(techResults[i]) techMap[s]=techResults[i]; });

  // Breadth + Sentiment
  const breadth   = calcBreadth(data);
  const sentiment = calcSentiment(data, techMap['SPY']);
  const sentLabel = sentiment>=70?'Bullish':sentiment>=55?'Mildly Bullish':sentiment>=45?'Neutral':sentiment>=30?'Mildly Bearish':'Bearish';

  // VIX interpretation
  const vixLevel = data.VIX?.price;
  const vixNote  = !vixLevel ? '' : vixLevel<15 ? 'near multi-year lows — complacency risk' : vixLevel<20 ? 'low fear, risk-on environment' : vixLevel<25 ? 'elevated — caution warranted' : vixLevel<30 ? 'fear elevated — watch for oversold bounce' : 'fear spike — defensive posture warranted';

  // Yield curve (TLT=long, SHY=short — inversion proxy)
  const tltPct = data.TLT?.pct;
  const shyPct = data.SHY?.pct;
  let yieldNote = '';
  if(tltPct!==undefined && shyPct!==undefined) {
    if(tltPct < shyPct-0.5) yieldNote = 'yield curve steepening (long rates rising faster than short) — reflation signal';
    else if(tltPct > shyPct+0.5) yieldNote = 'yield curve flattening — recession watch signal';
    else yieldNote = 'yield curve stable';
  }

  // News
  const sixHoursAgo = Math.floor(Date.now()/1000)-(6*3600);
  const allNews = [...(genNews||[]),...(bizNews||[])]
    .filter(n=>n.datetime>sixHoursAgo&&!geoNoise(n.headline)&&mktRel(n.headline))
    .sort((a,b)=>b.datetime-a.datetime).slice(0,6);
  const headlines = allNews.length ? allNews.map(n=>`• ${n.headline}`).join('\n') : 'No major economic catalysts in the last 6 hours.';

  // Tech narrative strings
  const techLines = TECH_SYMS.map(s=>techNarrative(techMap[s])).filter(Boolean);
  const techSummary = techLines.length ? techLines.map(l=>`• ${l}`).join('\n') : 'Technical data unavailable.';

  function fmt(s){ const d=data[s]; if(!d) return `${s}: N/A`; return `${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`; }

  const priceSummary = [
    `Indexes: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VIX: ${vixLevel?vixLevel.toFixed(1):'N/A'} (${vixNote}) | Bonds: TLT ${data.TLT?.pct?.toFixed(2)||'N/A'}%`,
    `Yield curve: ${yieldNote}`,
    `Mega-caps: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')} | ${fmt('AMZN')}`,
    `Sectors: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Fins ${fmt('XLF')} | Health ${fmt('XLV')} | Ind ${fmt('XLI')}`,
    `Market Breadth: ${breadth.up} of ${breadth.total} sectors positive (${breadth.pct}% advancing)`,
    `Sentiment Score: ${sentiment}/100 — ${sentLabel}`,
  ].join('\n');

  let narrative = 'Market data loaded.';

  if(ANTHROPIC) {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:500,
        system:`You are a senior market analyst on a trading desk writing a real-time market pulse for professional traders.
Write exactly 5 sentences:
1. MACRO: Lead with the dominant theme and the key economic/earnings catalyst. Include breadth context (e.g. "8 of 11 sectors green — broad-based rally" or "only tech positive — narrow rally on thin ice").
2. SECTORS: Sector rotation story — what is leading, lagging, and why. Reference the yield curve or VIX if relevant.
3. MOVERS: Biggest individual stock move and its specific catalyst. Include volume context if notable.
4. TECHNICALS: Weave in the MA levels, RSI, and MACD signals. Be specific and actionable — e.g. "SPY is 2.1% above its 200-day MA at $512 with RSI at 58 — momentum intact but not overbought; QQQ is testing its 20-day at $712, a close below flips the short-term trend bearish."
5. WATCH: One specific level, catalyst, or data release to monitor. Reference the sentiment score naturally.
Rules: Use exact numbers. Never split a decimal. Active voice. No disclaimers. Sound like a Bloomberg terminal alert.`,
        messages:[{role:'user',content:`Session: ${session} | ${timeStr}

PRICE ACTION & MACRO:
${priceSummary}

TECHNICAL LEVELS (SMA20/50/200, RSI14, MACD, Volume):
${techSummary}

ECONOMIC & EARNINGS CATALYSTS (last 6 hours):
${headlines}

Write the 5-sentence market pulse.`}]
      })
    });
    if(aiResp.ok){ const d=await aiResp.json(); narrative=d.content?.[0]?.text||narrative; }
  }

  const result={narrative,data,session,isOpen,timeStr,breadth,sentiment,sentLabel,technicals:techMap,vixNote,yieldNote};
  _cache=result; _cacheTime=Date.now();
  return new Response(JSON.stringify(result),{headers:CORS});
}
