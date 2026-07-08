export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON   = process.env.POLYGON_API_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

let _cache = null;
let _cacheTime = 0;
let _candleCache = {};
let _candleCacheTime = {};
const CACHE_TTL = 5 * 60 * 1000;
const CANDLE_TTL = 60 * 60 * 1000; // candles cache 1 hour

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

// ── TECHNICALS ────────────────────────────────────────────────────────────
function sma(arr, n) { return arr.length<n?null:arr.slice(0,n).reduce((a,b)=>a+b,0)/n; }

function rsi(closes, n=14) {
  if(closes.length<n+1) return null;
  const rev=[...closes].reverse();
  let g=0,l=0;
  for(let i=1;i<=n;i++){const d=rev[i]-rev[i-1];d>0?g+=d:l+=Math.abs(d);}
  const ag=g/n,al=l/n;
  return al===0?100:100-(100/(1+ag/al));
}

function macdSignal(closes) {
  if(closes.length<35) return null;
  const rev=[...closes].reverse();
  const k12=2/13,k26=2/27;
  let e12=rev.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let e26=rev.slice(0,26).reduce((a,b)=>a+b,0)/26;
  for(let i=12;i<rev.length;i++) e12=rev[i]*k12+e12*(1-k12);
  for(let i=26;i<rev.length;i++) e26=rev[i]*k26+e26*(1-k26);
  const line=e12-e26;
  return {line:line.toFixed(3), bullish:line>0};
}

async function getCandles(sym) {
  const now=Date.now();
  if(_candleCache[sym]&&now-_candleCacheTime[sym]<CANDLE_TTL) return _candleCache[sym];
  if(!POLYGON) return null;
  const to=new Date().toISOString().split('T')[0];
  const from=new Date(now-220*86400000).toISOString().split('T')[0];
  const d=await sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=220&apiKey=${POLYGON}`,7000);
  const res=d?.results||null;
  if(res){ _candleCache[sym]=res; _candleCacheTime[sym]=now; }
  return res;
}

async function getTech(sym) {
  const c=await getCandles(sym);
  if(!c||c.length<55) return {sym,error:'insufficient data'};
  const closes=c.map(x=>x.c);
  const vols=c.map(x=>x.v);
  const curr=closes[0];
  const s20=sma(closes,20), s50=sma(closes,50), s200=sma(closes,200);
  const r14=rsi(closes,14);
  const mc=macdSignal(closes);
  const avgVol=sma(vols,20);
  const volR=avgVol?vols[0]/avgVol:null;
  const h52=Math.max(...c.slice(0,Math.min(252,c.length)).map(x=>x.h));
  const l52=Math.min(...c.slice(0,Math.min(252,c.length)).map(x=>x.l));
  return {
    sym, price:curr,
    sma20:s20, sma50:s50, sma200:s200,
    vs20:s20?((curr-s20)/s20*100):null,
    vs50:s50?((curr-s50)/s50*100):null,
    vs200:s200?((curr-s200)/s200*100):null,
    rsi14:r14, macd:mc,
    volRatio:volR,
    high52:h52, low52:l52,
    pct52High:((curr-h52)/h52*100),
  };
}

function techBlock(t) {
  if(!t||t.error) return null;
  const p=n=>n!==null&&n!==undefined?n.toFixed(2):null;
  const lines=[];

  // 200-day — key trend indicator
  if(t.vs200!==null){
    const a=Math.abs(t.vs200).toFixed(1);
    if(Math.abs(t.vs200)<0.8) lines.push(`${t.sym} sitting on its 200-day MA ($${p(t.sma200)}) — critical trend decision point`);
    else if(t.vs200>0) lines.push(`${t.sym} ${a}% above 200-day MA ($${p(t.sma200)}) — uptrend intact`);
    else lines.push(`${t.sym} ${a}% below 200-day MA ($${p(t.sma200)}) — bearish structure`);
  }

  // 20-day — short-term momentum
  if(t.vs20!==null){
    if(Math.abs(t.vs20)<0.4) lines.push(`testing 20-day at $${p(t.sma20)}`);
    else if(t.vs20>0) lines.push(`${t.vs20.toFixed(1)}% above 20-day ($${p(t.sma20)})`);
    else lines.push(`${Math.abs(t.vs20).toFixed(1)}% below 20-day ($${p(t.sma20)})`);
  }

  // RSI with specific levels
  if(t.rsi14!==null){
    const r=t.rsi14.toFixed(0);
    if(t.rsi14>75)      lines.push(`RSI ${r} — overbought, elevated reversal risk`);
    else if(t.rsi14>60) lines.push(`RSI ${r} — momentum firm`);
    else if(t.rsi14<30) lines.push(`RSI ${r} — oversold, watch for bounce`);
    else if(t.rsi14<40) lines.push(`RSI ${r} — momentum weakening`);
    else                lines.push(`RSI ${r} — neutral`);
  }

  // MACD direction
  if(t.macd){
    lines.push(`MACD ${t.macd.bullish?'positive (bullish bias)':'negative (bearish bias)'} at ${t.macd.line}`);
  }

  // Volume conviction
  if(t.volRatio!==null){
    if(t.volRatio>1.5)       lines.push(`volume ${t.volRatio.toFixed(1)}x above average — institutional conviction`);
    else if(t.volRatio<0.55) lines.push(`volume ${Math.round((1-t.volRatio)*100)}% below average — thin tape, low conviction`);
  }

  // 52W context
  if(t.pct52High>-2)       lines.push(`near 52-week highs ($${p(t.high52)})`);
  else if(t.pct52High<-15) lines.push(`${Math.abs(t.pct52High).toFixed(0)}% off 52-week high ($${p(t.high52)})`);

  return lines.length?`${t.sym}: ${lines.join(', ')}`:null;
}

// ── NEWS FILTERS ──────────────────────────────────────────────────────────
const MKT_KW=['fed','federal reserve','fomc','rate','inflation','cpi','pce','jobs','gdp','payroll','earnings','revenue','profit','beat','miss','eps','guidance','outlook','forecast','yield','treasury','bond','rate cut','rate hike','interest rate','economic','economy','recession','growth','unemployment','retail sales','ism','pmi','manufacturing','housing','consumer','spending','rally','selloff','sell-off','plunge','surge','jump','drop','decline','gain','stocks','market','nasdaq','s&p','dow','equities','wall street','oil','gold','dollar','crypto','bitcoin','merger','acquisition','ipo','apple','nvidia','microsoft','meta','tesla','amazon','google','alphabet','jpmorgan','semiconductor','ai','artificial intelligence','cloud','tech','tariff','trade','quarter','fiscal','annual','report','results'];
const GEO_KW=['war','military','troops','soldier','attack','bomb','missile','ukraine','russia','israel','gaza','hamas','iran','north korea','election','vote','president','congress','senate','democrat','republican','crime','murder','shooting','arrest','police','court','trial','weather','hurricane','earthquake','flood','tornado','celebrity','entertainment','oscar','grammy','nfl','nba','mlb'];
const mktRel=h=>{const l=h.toLowerCase();return MKT_KW.some(k=>l.includes(k));};
const geoNoise=h=>{const l=h.toLowerCase();return GEO_KW.some(k=>l.includes(k));};

// ── BREADTH & SENTIMENT ───────────────────────────────────────────────────
function calcBreadth(data){
  const s=['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const up=s.filter(x=>data[x]&&data[x].pct>0).length;
  const tot=s.filter(x=>data[x]).length;
  return {up,total:tot,pct:tot?Math.round(up/tot*100):null};
}

function calcSentiment(data,spyT){
  let sc=50;
  if(data.SPY) sc+=Math.max(-12,Math.min(12,data.SPY.pct*4));
  if(data.VIX){const v=data.VIX.price;sc+=v<15?12:v<20?6:v<25?0:v<30?-10:-18;}
  if(spyT?.vs200!=null) sc+=spyT.vs200>0?8:-8;
  if(spyT?.rsi14!=null){const r=spyT.rsi14;sc+=r>60?5:r<40?-5:0;}
  const b=calcBreadth(data);
  if(b.pct!=null) sc+=b.pct>70?10:b.pct>55?4:b.pct<30?-10:-4;
  if(spyT?.macd?.bullish!=null) sc+=spyT.macd.bullish?5:-5;
  return Math.max(0,Math.min(100,Math.round(sc)));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  if(_cache&&Date.now()-_cacheTime<CACHE_TTL) return new Response(JSON.stringify({..._cache,cached:true}),{headers:CORS});

  const now=new Date();
  const et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(),m=et.getMinutes(),dow=et.getDay();
  const isOpen=dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const session=isOpen?'Market Open':dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30))?'Pre-Market':dow>=1&&dow<=5&&h>=16&&h<20?'After Hours':'Market Closed';
  const timeStr=et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  const PRICE_SYMS=['SPY','QQQ','DIA','IWM','VIX','TLT','SHY','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const TECH_SYMS=['SPY','QQQ','XLK']; // limit to 3 for speed

  // Fetch prices and technicals in parallel — technicals have their own cache
  const [quotes,genNews,bizNews,...techArr]=await Promise.all([
    Promise.all(PRICE_SYMS.map(s=>sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`,5000),
    sf(`https://finnhub.io/api/v1/news?category=business&minId=0&token=${FINNHUB}`,5000),
    ...TECH_SYMS.map(s=>getTech(s)),
  ]);

  const data={};
  PRICE_SYMS.forEach((s,i)=>{const d=quotes[i];if(d&&(d.c||d.pc))data[s]={price:d.c||d.pc,pct:d.dp||0,change:d.d||0};});

  const techMap={};
  TECH_SYMS.forEach((s,i)=>{if(techArr[i]&&!techArr[i].error)techMap[s]=techArr[i];});

  const breadth=calcBreadth(data);
  const sentiment=calcSentiment(data,techMap.SPY);
  const sentLabel=sentiment>=70?'Bullish':sentiment>=55?'Mildly Bullish':sentiment>=45?'Neutral':sentiment>=30?'Mildly Bearish':'Bearish';

  const vixVal=data.VIX?.price;
  const vixNote=!vixVal?'':vixVal<15?'near multi-year lows — complacency risk':vixVal<20?'low fear — risk-on':vixVal<25?'elevated — caution':vixVal<30?'fear elevated — watch for bounce':'fear spike — defensive posture';

  const tltPct=data.TLT?.pct, shyPct=data.SHY?.pct;
  const yieldNote=tltPct!=null&&shyPct!=null?(tltPct<shyPct-0.4?'yield curve steepening (long rates rising — reflation/inflation signal)':tltPct>shyPct+0.4?'yield curve flattening — growth concern':'yield curve stable'):'';

  // News — filter + dedupe
  const sixH=Math.floor(Date.now()/1000)-(6*3600);
  const seen=new Set();
  const allNews=[...(genNews||[]),...(bizNews||[])]
    .filter(n=>n.datetime>sixH&&!geoNoise(n.headline)&&mktRel(n.headline))
    .sort((a,b)=>b.datetime-a.datetime)
    .filter(n=>{if(seen.has(n.headline))return false;seen.add(n.headline);return true;})
    .slice(0,8);
  const headlines=allNews.length?allNews.map(n=>`• ${n.headline} [${n.source}]`).join('\n'):'No major economic or earnings catalysts in the last 6 hours.';

  // Technical blocks
  const techLines=TECH_SYMS.map(s=>techBlock(techMap[s])).filter(Boolean);
  const techSummary=techLines.length?techLines.join('\n'):'Technicals: awaiting candle data.';

  const fmt=s=>{const d=data[s];return d?`${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`:`${s} N/A`;};

  const context=[
    `=== SESSION: ${session} | ${timeStr} ===`,
    ``,
    `INDEXES: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VOLATILITY: VIX ${vixVal?vixVal.toFixed(1):'N/A'} — ${vixNote}`,
    `BONDS: TLT ${data.TLT?.pct?.toFixed(2)||'N/A'}% | ${yieldNote}`,
    `BREADTH: ${breadth.up} of ${breadth.total} sectors advancing — ${breadth.pct}% positive`,
    `SENTIMENT SCORE: ${sentiment}/100 — ${sentLabel}`,
    ``,
    `SECTORS: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Fins ${fmt('XLF')} | Health ${fmt('XLV')} | Ind ${fmt('XLI')} | Disc ${fmt('XLY')} | Staples ${fmt('XLP')}`,
    ``,
    `MEGA-CAPS: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')} | ${fmt('AMZN')} | ${fmt('JPM')}`,
    ``,
    `TECHNICAL LEVELS (daily candles — SMA20/50/200, RSI14, MACD, Volume):`,
    techSummary,
    ``,
    `ECONOMIC & EARNINGS CATALYSTS (last 6 hours):`,
    headlines,
  ].join('\n');

  let narrative='Market data loaded — refresh to try AI analysis.';

  if(ANTHROPIC){
    const aiResp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:600,
        system:`You are a senior macro/equity analyst on a trading desk writing a real-time market pulse note for professional traders and portfolio managers.

Write exactly 6 SHORT, PUNCHY sentences. Each sentence should be ONE clear idea. No run-ons. No semicolons to chain ideas. Each sentence ends with a period.

Structure:
1. MACRO THEME: What is the single dominant narrative driving the market today? Name the specific catalyst (Fed, CPI, earnings, macro data). Include breadth — is this broad-based or narrow?
2. RATES & MACRO: What are bonds, yields, and the yield curve doing? How does this connect to the macro theme? What does VIX signal about risk appetite?
3. SECTOR STORY: Which sector is leading and which is lagging? Name the specific ETF and connect it to the macro catalyst.
4. TOP MOVER: The single biggest individual stock move — name it, give the exact % move, and state the specific catalyst driving it.
5. TECHNICAL PICTURE: Reference the ACTUAL technical levels provided — specific MAs, RSI, MACD. Make it actionable: "SPY holds above its 200-day at $512 — bull trend intact" or "QQQ is testing 20-day support at $712 with RSI 38 — a close below opens the door to $695."
6. WATCH: One specific level, catalyst, or upcoming event to monitor. Reference the sentiment score naturally at the end.

Critical rules:
- Each sentence = one idea only. Short and sharp.
- Never split a decimal number across a line (1.85% must stay together).
- Use exact numbers from the data provided.
- If technical data says "awaiting" — skip the MA levels and focus on RSI and price action.
- Active voice always. No passive. No hedging. No disclaimers.`,
        messages:[{role:'user',content:`${context}\n\nWrite the 6-sentence market pulse note.`}]
      })
    });
    if(aiResp.ok){const d=await aiResp.json();narrative=d.content?.[0]?.text||narrative;}
  }

  const result={narrative,data,session,isOpen,timeStr,breadth,sentiment,sentLabel,vixNote,yieldNote,technicals:techMap};
  _cache=result;_cacheTime=Date.now();
  return new Response(JSON.stringify(result),{headers:CORS});
}
