export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON   = process.env.POLYGON_API_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

let _cache = null;
let _cacheTime = 0;
let _candleCache = {};
let _candleCacheTime = {};
const CACHE_TTL  = 5 * 60 * 1000;
const CANDLE_TTL = 60 * 60 * 1000;

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

// ── TICKER EXTRACTION FROM HEADLINES ─────────────────────────────────────
// Common company name → ticker map
const NAME_TO_TICKER = {
  'apple':'AAPL','nvidia':'NVDA','microsoft':'MSFT','meta':'META','alphabet':'GOOGL',
  'google':'GOOGL','amazon':'AMZN','tesla':'TSLA','jpmorgan':'JPM','jp morgan':'JPM',
  'exxon':'XOM','exxonmobil':'XOM','chevron':'CVX','berkshire':'BRK.B',
  'walmart':'WMT','unitedhealth':'UNH','johnson':'JNJ','visa':'V','mastercard':'MA',
  'netflix':'NFLX','salesforce':'CRM','adobe':'ADBE','intel':'INTC','amd':'AMD',
  'broadcom':'AVGO','qualcomm':'QCOM','micron':'MU','applied materials':'AMAT',
  'boeing':'BA','caterpillar':'CAT','deere':'DE','3m':'MMM',
  'bank of america':'BAC','wells fargo':'WFC','goldman':'GS','morgan stanley':'MS',
  'pfizer':'PFE','merck':'MRK','abbvie':'ABBV','lilly':'LLY','novo nordisk':'NVO',
  'fed':'',  // Fed = macro, no ticker
  'federal reserve':'',
  'exxon mobil':'XOM',
  'saudi aramco':'',
  'opec':'USO',
};

function extractTickers(headlines) {
  const found = new Set();
  // Match $TICKER pattern
  const dollarMatches = headlines.match(/\$([A-Z]{1,5})\b/g)||[];
  dollarMatches.forEach(m=>found.add(m.replace('$','')));
  // Match (TICKER) pattern
  const parenMatches = headlines.match(/\(([A-Z]{2,5})\)/g)||[];
  parenMatches.forEach(m=>found.add(m.replace(/[()]/g,'')));
  // Match company names
  const lower = headlines.toLowerCase();
  Object.entries(NAME_TO_TICKER).forEach(([name,ticker])=>{
    if(ticker && lower.includes(name)) found.add(ticker);
  });
  // Filter out non-stock words that look like tickers
  const EXCLUDE = new Set(['A','I','IT','IS','AT','IN','ON','BY','OR','AND','THE','FOR','WITH','FROM','CEO','CFO','IPO','GDP','CPI','PCE','ISM','PMI','EPS','ETF','USA','USD','EUR','FED','SEC','FDA','DOJ','FTC','AI','EV','AR','VR']);
  return [...found].filter(t=>t.length>=2&&t.length<=5&&!EXCLUDE.has(t)).slice(0,8);
}

// ── TECHNICALS ────────────────────────────────────────────────────────────
function sma(arr,n){return arr.length<n?null:arr.slice(0,n).reduce((a,b)=>a+b,0)/n;}
function rsi(closes,n=14){
  if(closes.length<n+1)return null;
  const rev=[...closes].reverse();
  let g=0,l=0;
  for(let i=1;i<=n;i++){const d=rev[i]-rev[i-1];d>0?g+=d:l+=Math.abs(d);}
  const ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));
}
function macdSignal(closes){
  if(closes.length<35)return null;
  const rev=[...closes].reverse();
  const k12=2/13,k26=2/27;
  let e12=rev.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let e26=rev.slice(0,26).reduce((a,b)=>a+b,0)/26;
  for(let i=12;i<rev.length;i++)e12=rev[i]*k12+e12*(1-k12);
  for(let i=26;i<rev.length;i++)e26=rev[i]*k26+e26*(1-k26);
  const line=e12-e26;return{line:line.toFixed(3),bullish:line>0};
}
async function getCandles(sym){
  const now=Date.now();
  if(_candleCache[sym]&&now-_candleCacheTime[sym]<CANDLE_TTL)return _candleCache[sym];
  if(!POLYGON)return null;
  const to=new Date().toISOString().split('T')[0];
  const from=new Date(now-220*86400000).toISOString().split('T')[0];
  const d=await sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=220&apiKey=${POLYGON}`,7000);
  const res=d?.results||null;
  if(res){_candleCache[sym]=res;_candleCacheTime[sym]=now;}
  return res;
}
async function getTech(sym){
  const c=await getCandles(sym);
  if(!c||c.length<55)return{sym,error:'insufficient data'};
  const closes=c.map(x=>x.c),vols=c.map(x=>x.v),curr=closes[0];
  const s20=sma(closes,20),s50=sma(closes,50),s200=sma(closes,200);
  const r14=rsi(closes,14),mc=macdSignal(closes);
  const avgVol=sma(vols,20),volR=avgVol?vols[0]/avgVol:null;
  const h52=Math.max(...c.slice(0,Math.min(252,c.length)).map(x=>x.h));
  return{sym,price:curr,sma20:s20,sma50:s50,sma200:s200,
    vs20:s20?((curr-s20)/s20*100):null,vs50:s50?((curr-s50)/s50*100):null,
    vs200:s200?((curr-s200)/s200*100):null,
    rsi14:r14,macd:mc,volRatio:volR,high52:h52,pct52High:((curr-h52)/h52*100)};
}
function techBlock(t){
  if(!t||t.error)return null;
  const p=n=>n!=null?n.toFixed(2):null;
  const lines=[];
  if(t.vs200!=null){
    if(Math.abs(t.vs200)<0.8)lines.push(`${t.sym} on 200-day MA ($${p(t.sma200)}) — critical inflection`);
    else if(t.vs200>0)lines.push(`${t.sym} ${t.vs200.toFixed(1)}% above 200-day ($${p(t.sma200)}) — uptrend intact`);
    else lines.push(`${t.sym} ${Math.abs(t.vs200).toFixed(1)}% below 200-day ($${p(t.sma200)}) — bearish structure`);
  }
  if(t.vs20!=null){
    if(Math.abs(t.vs20)<0.4)lines.push(`testing 20-day at $${p(t.sma20)}`);
    else if(t.vs20>0)lines.push(`${t.vs20.toFixed(1)}% above 20-day ($${p(t.sma20)})`);
    else lines.push(`${Math.abs(t.vs20).toFixed(1)}% below 20-day ($${p(t.sma20)})`);
  }
  if(t.rsi14!=null){
    const r=t.rsi14.toFixed(0);
    lines.push(t.rsi14>75?`RSI ${r} overbought`:t.rsi14>60?`RSI ${r} momentum firm`:t.rsi14<30?`RSI ${r} oversold`:t.rsi14<40?`RSI ${r} weakening`:`RSI ${r} neutral`);
  }
  if(t.macd)lines.push(`MACD ${t.macd.bullish?'positive':'negative'} (${t.macd.line})`);
  if(t.volRatio!=null){
    if(t.volRatio>1.5)lines.push(`volume ${t.volRatio.toFixed(1)}x avg — conviction`);
    else if(t.volRatio<0.55)lines.push(`volume ${Math.round((1-t.volRatio)*100)}% below avg — thin tape`);
  }
  return lines.length?`${t.sym}: ${lines.join(', ')}`:null;
}

// ── NEWS FILTERS ──────────────────────────────────────────────────────────
const MKT_KW=['fed','federal reserve','fomc','rate','inflation','cpi','pce','jobs','gdp','payroll','earnings','revenue','profit','beat','miss','eps','guidance','outlook','forecast','yield','treasury','bond','rate cut','rate hike','interest rate','economic','economy','recession','growth','unemployment','retail sales','ism','pmi','manufacturing','housing','consumer','spending','rally','selloff','sell-off','plunge','surge','jump','drop','decline','gain','stocks','market','nasdaq','s&p','dow','equities','wall street','oil','gold','dollar','crypto','bitcoin','merger','acquisition','ipo','semiconductor','ai','artificial intelligence','cloud','tech','tariff','trade','quarter','fiscal','annual','report','results'];
const GEO_KW=['war','military','troops','soldier','attack','bomb','missile','ukraine','russia','israel','gaza','hamas','iran','north korea','election','vote','president','congress','senate','democrat','republican','crime','murder','shooting','arrest','police','court','trial','weather','hurricane','earthquake','flood','tornado','celebrity','entertainment','oscar','grammy','nfl','nba','mlb','cargo incident','ship','vessel','strait','sanctions','pipeline incident','port disruption','pakistan','india','afghanistan','syria','somalia','yemen','sudan','ethiopia','nigeria','kenya','mexico cartel','drug','hostage'];
const mktRel=h=>{const l=h.toLowerCase();return MKT_KW.some(k=>l.includes(k));};
const geoNoise=h=>{const l=h.toLowerCase();return GEO_KW.some(k=>l.includes(k));};

function calcBreadth(data){
  const s=['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const up=s.filter(x=>data[x]&&data[x].pct>0).length;
  const tot=s.filter(x=>data[x]).length;
  return{up,total:tot,pct:tot?Math.round(up/tot*100):null};
}
function calcSentiment(data,spyT){
  let sc=50;
  if(data.SPY)sc+=Math.max(-12,Math.min(12,data.SPY.pct*4));
  if(data.VIX){const v=data.VIX.price;sc+=v<15?12:v<20?6:v<25?0:v<30?-10:-18;}
  if(spyT?.vs200!=null)sc+=spyT.vs200>0?8:-8;
  if(spyT?.rsi14!=null){const r=spyT.rsi14;sc+=r>60?5:r<40?-5:0;}
  const b=calcBreadth(data);
  if(b.pct!=null)sc+=b.pct>70?10:b.pct>55?4:b.pct<30?-10:-4;
  if(spyT?.macd?.bullish!=null)sc+=spyT.macd.bullish?5:-5;
  return Math.max(0,Math.min(100,Math.round(sc)));
}

// ── MAIN ──────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
  const thisCacheKey='v2-structured';
if(_cache&&_cacheKey===thisCacheKey&&Date.now()-_cacheTime<CACHE_TTL)return new Response(JSON.stringify({..._cache,cached:true}),{headers:CORS});

  const now=new Date();
  const et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(),m=et.getMinutes(),dow=et.getDay();
  const isOpen=dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const session=isOpen?'Market Open':dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30))?'Pre-Market':dow>=1&&dow<=5&&h>=16&&h<20?'After Hours':'Market Closed';
  const timeStr=et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  const BASE_SYMS=['SPY','QQQ','DIA','IWM','VIX','TLT','SHY','XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLRE','XLC','XLB'];
  const TECH_SYMS=['SPY','QQQ','XLK'];

  // Step 1: fetch news first to extract dynamic tickers
  const [genNews,bizNews]=await Promise.all([
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`,5000),
    sf(`https://finnhub.io/api/v1/news?category=business&minId=0&token=${FINNHUB}`,5000),
  ]);

  const sixH=Math.floor(Date.now()/1000)-(12*3600); // 12 hour window
  const seen=new Set();
  const filteredNews=[...(genNews||[]),...(bizNews||[])]
    .filter(n=>n.datetime>sixH&&mktRel(n.headline))
    .sort((a,b)=>b.datetime-a.datetime)
    .filter(n=>{if(seen.has(n.headline))return false;seen.add(n.headline);return true;})
    .slice(0,15);

  // Extract tickers mentioned in headlines
  const allHeadlineText=filteredNews.map(n=>n.headline).join(' ');
  const newsTickers=extractTickers(allHeadlineText);

  // Step 2: fetch all quotes including news-driven tickers
  const allSyms=[...new Set([...BASE_SYMS,...newsTickers])];
  const [quotes,...techArr]=await Promise.all([
    Promise.all(allSyms.map(s=>sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    ...TECH_SYMS.map(s=>getTech(s)),
  ]);

  const data={};
  allSyms.forEach((s,i)=>{const d=quotes[i];if(d&&(d.c||d.pc))data[s]={price:d.c||d.pc,pct:d.dp||0,change:d.d||0};});

  const techMap={};
  TECH_SYMS.forEach((s,i)=>{if(techArr[i]&&!techArr[i].error)techMap[s]=techArr[i];});

  const breadth=calcBreadth(data);
  const sentiment=calcSentiment(data,techMap.SPY);
  const sentLabel=sentiment>=70?'Bullish':sentiment>=55?'Mildly Bullish':sentiment>=45?'Neutral':sentiment>=30?'Mildly Bearish':'Bearish';

  const vixVal=data.VIX?.price;
  const vixNote=!vixVal?'':vixVal<15?'near multi-year lows — complacency risk':vixVal<20?'low fear — risk-on':vixVal<25?'elevated — caution':vixVal<30?'fear elevated':' fear spike — go defensive';
  const tltPct=data.TLT?.pct,shyPct=data.SHY?.pct;
  const yieldNote=tltPct!=null&&shyPct!=null?(tltPct<shyPct-0.4?'yield curve steepening — reflation signal':tltPct>shyPct+0.4?'yield curve flattening — growth concern':'yield curve stable'):'';

  const headlines=filteredNews.length?filteredNews.slice(0,12).map(n=>`• [${n.category||'market'}] ${n.headline} (${n.source})`).join('\n'):'No major economic or earnings catalysts in the last 6 hours.';

  // News-driven quotes summary
  const newsQuotes=newsTickers.filter(s=>data[s]).map(s=>{
    const d=data[s];
    return `${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`;
  }).join(' | ');

  const techLines=TECH_SYMS.map(s=>techBlock(techMap[s])).filter(Boolean);
  const techSummary=techLines.length?techLines.join('\n'):'Technicals: awaiting candle data.';

  const fmt=s=>{const d=data[s];return d?`${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`:`${s} N/A`;};

  const context=[
    `SESSION: ${session} | ${timeStr}`,
    `INDEXES: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VIX: ${vixVal?vixVal.toFixed(1):'N/A'} — ${vixNote} | BONDS: TLT ${data.TLT?.pct?.toFixed(2)||'N/A'}% | ${yieldNote}`,
    `BREADTH: ${breadth.up}/${breadth.total} sectors advancing (${breadth.pct}%) | SENTIMENT: ${sentiment}/100 — ${sentLabel}`,
    `SECTORS: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Fins ${fmt('XLF')} | Health ${fmt('XLV')} | Ind ${fmt('XLI')} | Disc ${fmt('XLY')}`,
    newsQuotes?`NEWS-DRIVEN MOVERS: ${newsQuotes}`:'',
    `\nTECHNICAL LEVELS:\n${techSummary}`,
    `\nECONOMIC & EARNINGS CATALYSTS (last 6h):\n${headlines}`,
  ].filter(Boolean).join('\n');

  let narrative='Market data loaded.';
  if(ANTHROPIC){
    const aiResp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01','anthropic-beta':'prompt-caching-2024-07-31'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:1800,
        system:[{type:'text',text:`You are a seasoned Wall Street market commentator writing the definitive daily market narrative for serious institutional investors. You write with authority, precision, and depth. Every sentence contains a specific number or data point. No hedging. No vague language.

MANDATORY FORMAT — output exactly this structure:

First write a 3-sentence hook paragraph. Sentence 1: bold declarative with a specific index level and percentage. Sentence 2: the dominant theme with a sector name and percentage. Sentence 3: one unexpected or contradictory signal that reveals what is happening beneath the surface. Never end the hook with a question.

Then output exactly this on its own line:
---

Then write exactly 5 body paragraphs separated by blank lines:

Paragraph 1 — Price Action: Cover every major index (S&P, Nasdaq, Dow, Russell) with specific closing levels and percentages. State exact breadth (X of 11 sectors advancing). Note volume vs average. 3-5 sentences.

Paragraph 2 — Sector Rotation: Name the top 2-3 leading sectors with exact percentages. Name the laggards. Explain what this rotation pattern signals about where institutional money is moving. 3-5 sentences.

Paragraph 3 — Macro Backdrop: Cover Treasury yields, VIX level, sentiment score (X/100), and what the bond market is pricing. Connect yield moves to equity positioning. 3-5 sentences.

Paragraph 4 — Institutional Flow: What today's cross-market action reveals about smart money positioning. Connect the dots between sector moves, yield behavior, and sentiment. The real story beneath the headline numbers. 3-5 sentences.

Paragraph 5 — Tomorrow's Triggers: Two specific scenarios with named catalysts, exact price levels to watch, and sector implications. End with a declarative statement about what will determine the next directional move. 3-5 sentences.

WRITING RULES:
- Every sentence must contain at least one specific number from the data
- No bullet points anywhere in the output
- No subheadings in the body paragraphs
- No "it remains to be seen" or "investors will be watching"
- Total output: 450-600 words
- The hook must be exactly 3 sentences before the --- separator
- Sound like: "Nasdaq's 1.85% collapse masks a sharp geopolitical pivot: energy and inflation trades are roaring back as US military strikes on Iran disrupt the fragile ceasefire narrative that had anchored tech valuations for weeks."`,cache_control:{type:'ephemeral'}}]
        messages:[{role:'user',content:`${context}\n\nWrite the 6-sentence market pulse.`}]
      })
    });
    if(aiResp.ok){
      const d=await aiResp.json();
      let raw=d.content?.[0]?.text||narrative;
      // Strip markdown artifacts - use simple line-by-line approach
      raw = raw.split('\n').map(function(line){
        // Remove # headers
        if(/^#{1,4}\s/.test(line)) return '';
        // Normalize --- dividers
        if(/^[-]{3,}\s*$/.test(line)) return '---';
        return line;
      }).join('\n');
      // Remove bold/italic markers
      raw = raw.replace(/\*\*([^*]+)\*\*/g,'$1');
      raw = raw.replace(/\*([^*]+)\*/g,'$1');
      raw = raw.trim();
      // Never end on a question mark — replace with period
      raw = raw.replace(/\?(\.)?$/,'.');
      raw = raw.replace(/\?\s*$/,'.');
      // Remove any --- that leaked into first section by ensuring clean split
      raw = raw.replace(/([^\n])---/g,'$1\n---');
      // If no --- delimiter, try to split after first 2 sentences
      if(raw.indexOf('\n---\n')===-1&&raw.indexOf('---')===-1){
        // Find end of 2nd sentence
        var sentences=raw.match(/[^.!?]+[.!?]+/g)||[];
        if(sentences.length>2){
          var hook=sentences.slice(0,2).join('').trim();
          var rest=sentences.slice(2).join('').trim();
          raw=hook+'\n---\n'+rest;
        }
      }
      // Clean up multiple blank lines
      raw=raw.replace(/\n{3,}/g,'\n\n');
      narrative=raw;
    }
  }

  const result={
    narrative,data,session,isOpen,timeStr,
    breadth,sentiment,sentLabel,vixNote,yieldNote,
    newsTickers,technicals:techMap
  };
  _cache=result;_cacheTime=Date.now();
  return new Response(JSON.stringify(result),{headers:CORS});
}
