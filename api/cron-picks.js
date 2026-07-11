export const config = { maxDuration: 60 };

const FINNHUB    = process.env.FINNHUB_KEY;
const POLYGON    = process.env.POLYGON_API_KEY;
const ANTHROPIC  = process.env.ANTHROPIC_API_KEY;
const GIST_TOKEN = process.env.GITHUB_TOKEN;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET;
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

async function sf(url, t=6000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(),t);
    const r = await fetch(url,{signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

function calcSMA(arr, n) {
  if(!arr||arr.length<n) return null;
  return arr.slice(-n).reduce((a,b)=>a+b,0)/n;
}
function calcRSI(closes) {
  if(!closes||closes.length<15) return null;
  const c=closes.slice(-15); let g=0,l=0;
  for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];d>0?g+=d:l+=Math.abs(d);}
  const ag=g/14,al=l/14; return al===0?100:100-(100/(1+ag/al));
}

// STEP 1: Get universe via Polygon snapshot (one call, fast)
async function getUniverse() {
  const TOP50 = 'AAPL,MSFT,NVDA,GOOGL,META,AMZN,TSLA,JPM,V,UNH,XOM,CVX,LLY,JNJ,ABBV,HD,PG,MA,MRK,PEP,COST,KO,BAC,WMT,AVGO,TMO,CSCO,ACN,ABT,CRM,MCD,ADBE,PFE,DIS,NFLX,AMD,INTC,GS,MS,CAT,DE,RTX,HON,BA,GE,LMT,UPS,WFC,C,ISRG';
  const snap = await sf(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${TOP50}&apiKey=${POLYGON}`,8000);
  if(!snap?.tickers?.length) return [];
  return snap.tickers.map(t=>({
    sym: t.ticker,
    price: t.day?.c || t.prevDay?.c || 0,
    pct:   t.todaysChangePerc || 0,
    volume:t.day?.v || t.prevDay?.v || 0,
    vwap:  t.day?.vw || t.prevDay?.vw || 0,
    pct1M: null, // filled in enrich
  })).filter(s=>s.price>5);
}

// STEP 2: Quick score from snapshot data only (no API calls)
function quickScore(s, macro) {
  let score = 50;
  // Price momentum
  if(s.pct>2)       score+=15;
  else if(s.pct>0.5)score+=8;
  else if(s.pct<-2) score-=10;
  // Volume
  if(s.volume>5e7)  score+=10;
  else if(s.volume>1e7) score+=5;
  // Macro alignment
  if(macro.riskOn && s.pct>0) score+=5;
  return Math.max(0,Math.min(100,score));
}

// STEP 3: Deep enrich TOP candidates only (10 stocks × 2 Finnhub calls = 20 calls)
async function deepEnrich(stock) {
  const sym = stock.sym;
  const today = new Date().toISOString().split('T')[0];
  const past90 = new Date(Date.now()-90*86400000).toISOString().split('T')[0];
  const past3  = new Date(Date.now()-3*86400000).toISOString().split('T')[0];

  const [candles, metrics, profile, news] = await Promise.all([
    sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${past90}/${today}?adjusted=true&sort=desc&limit=90&apiKey=${POLYGON}`,6000),
    sf(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB}`,5000),
    sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${past3}&to=${today}&token=${FINNHUB}`,4000),
  ]);

  const m = metrics?.metric||{};
  const closes = candles?.results ? [...candles.results].reverse().map(c=>c.c) : [];
  const vols   = candles?.results ? [...candles.results].reverse().map(c=>c.v) : [];
  const s20=calcSMA(closes,20), s50=calcSMA(closes,50), s200=calcSMA(closes,200);
  const rsi=calcRSI(closes);
  const avgVol=calcSMA(vols,20);
  const price1M=closes.length>=22?closes[closes.length-22]:null;
  const pct1M=price1M?((stock.price-price1M)/price1M):0;

  return {
    ...stock,
    name:    profile?.name||sym,
    sector:  profile?.finnhubIndustry||'Unknown',
    marketCap: profile?.marketCapitalization?profile.marketCapitalization*1e6:null,
    sma20:s20, sma50:s50, sma200:s200, rsi,
    above20MA: s20?stock.price>s20:null,
    above50MA: s50?stock.price>s50:null,
    above200MA:s200?stock.price>s200:null,
    vs50MA:  s50?(stock.price-s50)/s50*100:0,
    vs200MA: s200?(stock.price-s200)/s200*100:0,
    volRatio:avgVol&&stock.volume?stock.volume/avgVol:1,
    pct1M,
    revGrowth:   m.revenueGrowthTTMYoy||0,
    grossMargin: m.grossMarginTTM||0,
    netMargin:   m.netProfitMarginAnnual||0,
    pe:          m.peBasicExclExtraTTM||0,
    roe:         m.roeTTM||0,
    beta:        m.beta||1,
    eps:         m.epsBasicExclExtraAnnual||0,
    hasNews:     (news||[]).length>0,
    headlines:   (news||[]).slice(0,3).map(n=>n.headline),
  };
}

// STEP 4: Full score from enriched data
function fullScore(s, pickType, macro) {
  const WEIGHTS = {
    growth:   {mom:15,fund:40,tech:20,qual:25},
    momentum: {mom:40,fund:20,tech:30,qual:10},
    intraday: {mom:35,fund:10,tech:35,qual:20},
    general:  {mom:25,fund:25,tech:25,qual:25},
  };
  const w = WEIGHTS[pickType]||WEIGHTS.general;
  const reasons = [];

  let mom=50;
  if(s.pct>2){mom+=15;reasons.push(`+${s.pct.toFixed(1)}% today`);}
  else if(s.pct>0.5){mom+=8;}
  else if(s.pct<-1){mom-=10;}
  if(s.pct1M>0.10){mom+=15;reasons.push(`+${(s.pct1M*100).toFixed(0)}% 1M`);}
  else if(s.pct1M>0.03){mom+=8;}
  if(s.above50MA){mom+=7;}
  if(s.above200MA){mom+=5;}
  if(macro.riskOn&&s.pct>0){mom+=5;}
  mom=Math.max(0,Math.min(100,mom));

  let fund=50;
  if(s.revGrowth>0.20){fund+=20;reasons.push(`Rev+${(s.revGrowth*100).toFixed(0)}%`);}
  else if(s.revGrowth>0.10){fund+=12;}
  else if(s.revGrowth>0.05){fund+=6;}
  if(s.netMargin>0.15){fund+=10;reasons.push(`${(s.netMargin*100).toFixed(0)}% margin`);}
  else if(s.netMargin>0.05){fund+=5;}
  if(s.grossMargin>0.50){fund+=10;}
  else if(s.grossMargin>0.30){fund+=5;}
  if(s.pe>0&&s.pe<20){fund+=8;reasons.push(`P/E ${s.pe.toFixed(1)}x`);}
  fund=Math.max(0,Math.min(100,fund));

  let tech=50;
  if(s.rsi){
    const r=parseFloat(s.rsi);
    if(r<35){tech+=15;reasons.push(`RSI ${r.toFixed(0)} oversold`);}
    else if(r<50){tech+=8;}
    else if(r>=50&&r<=65){tech+=12;reasons.push(`RSI ${r.toFixed(0)}`);}
    else if(r>75){tech-=15;}
  }
  if(s.above20MA&&s.above50MA&&s.above200MA){tech+=20;reasons.push('Above all MAs');}
  else if(s.above50MA&&s.above200MA){tech+=12;}
  if(s.volRatio>1.3){tech+=8;reasons.push(`${s.volRatio.toFixed(1)}x vol`);}
  tech=Math.max(0,Math.min(100,tech));

  let qual=50;
  if(s.marketCap>50e9){qual+=15;}
  else if(s.marketCap>10e9){qual+=8;}
  if(s.beta&&s.beta<1.2){qual+=8;}
  else if(s.beta&&s.beta>2.5){qual-=8;}
  if(s.hasNews){qual+=8;} 
  qual=Math.max(0,Math.min(100,qual));

  const score=(mom*w.mom+fund*w.fund+tech*w.tech+qual*w.qual)/100;
  return {score:Math.round(score*10)/10, reasons:reasons.slice(0,3)};
}

async function generateThesis(pick, pickType, macro) {
  if(!ANTHROPIC) return pick.reasons.join('. ')+'.';
  try {
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:120,
        messages:[{role:'user',content:
          `2-sentence ${pickType} thesis for ${pick.sym} (${pick.name}). `+
          `Market: SPY ${macro.spyPct}%, VIX ${macro.vix}. `+
          `Stock: $${pick.price.toFixed(2)}, ${pick.pct.toFixed(2)}% today, RSI ${pick.rsi||'N/A'}, score ${pick.score}/100. `+
          `Signals: ${pick.reasons.join(', ')}. ${pick.headlines?.[0]||''}. `+
          `Sentence 1: core opportunity. Sentence 2: catalyst and price target. No questions.`
        }]
      })
    });
    if(!r.ok) return pick.reasons.join('. ')+'.';
    const d=await r.json();
    return d.content?.[0]?.text?.trim()||pick.reasons.join('. ')+'.';
  } catch(e){ return pick.reasons.join('. ')+'.'; }
}

export default async function handler(req, res) {
  const send=(status,body)=>{
    res.writeHead(status,CORS);
    res.end(typeof body==='string'?body:JSON.stringify(body));
  };
  if(req.method==='OPTIONS') return send(200,'');

  const secret  = req.query?.secret||'';
  const runType = req.query?.run||'full';
  const provided= (req.headers?.authorization||'').replace('Bearer ','')||secret;
  const valid   = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401,{error:'Unauthorized'});

  try {
    console.log('[picks] Starting',runType);

    // Macro
    const [spyQ,vixQ,tltQ]=await Promise.all([
      sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`,4000),
      sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`,4000),
      sf(`https://finnhub.io/api/v1/quote?symbol=TLT&token=${FINNHUB}`,4000),
    ]);
    const macro={
      spyPct:(spyQ?.dp||0).toFixed(2),
      vix:(vixQ?.c||20).toFixed(1),
      tltPct:(tltQ?.dp||0).toFixed(2),
      riskOn:(spyQ?.dp||0)>0&&(vixQ?.c||20)<22,
    };

    // STEP 1: Get universe snapshot (fast, 1 call)
    const universe = await getUniverse();
    console.log(`[picks] Universe: ${universe.length}`);
    if(!universe.length) return send(500,{error:'No market data available'});

    // STEP 2: Quick-score all, take top 20
    const quickScored = universe
      .map(s=>({...s,qs:quickScore(s,macro)}))
      .sort((a,b)=>b.qs-a.qs)
      .slice(0,20);
    console.log(`[picks] Top 20 quick-scored: ${quickScored.slice(0,3).map(s=>s.sym+':'+s.qs.toFixed(0)).join(', ')}`);

    // STEP 3: Deep enrich top 20 in parallel (Polygon unlimited + limited Finnhub)
    const enriched=[];
    for(let i=0;i<quickScored.length;i+=5){
      const batch=quickScored.slice(i,i+5);
      const results=await Promise.all(batch.map(s=>deepEnrich(s).catch(()=>s)));
      enriched.push(...results);
      if(i+5<quickScored.length) await new Promise(r=>setTimeout(r,400));
    }
    console.log(`[picks] Enriched: ${enriched.length}`);

    // STEP 4: Full score and build pick types
    const PICK_TYPES=['growth','momentum','intraday','general'];
    const pickTypes={};

    for(const pt of PICK_TYPES){
      const scored=enriched
        .map(s=>{const{score,reasons}=fullScore(s,pt,macro);return{...s,score,reasons};})
        .sort((a,b)=>b.score-a.score);

      const overall=scored.slice(0,5);
      if(overall[0]) overall[0].thesis=await generateThesis(overall[0],pt,macro);

      const bySector={};
      for(const s of scored){
        const sec=s.sector||'Unknown';
        if(!bySector[sec]) bySector[sec]=[];
        if(bySector[sec].length<5) bySector[sec].push(s);
      }

      const icons={growth:'🌱',momentum:'🚀',intraday:'⚡',general:'🎯'};
      const labels={growth:'Long-Term Growth',momentum:'Momentum / Swing',intraday:'Intraday',general:'Best Opportunity'};
      pickTypes[pt]={
        label:labels[pt], icon:icons[pt],
        overall:overall.map(s=>({
          sym:s.sym, name:s.name||s.sym, sector:s.sector||'',
          price:s.price, pct:s.pct, score:s.score,
          rsi:s.rsi?parseFloat(s.rsi).toFixed(0):null,
          above50MA:s.above50MA, above200MA:s.above200MA,
          sma50:s.sma50?s.sma50.toFixed(2):null,
          sma200:s.sma200?s.sma200.toFixed(2):null,
          reasons:s.reasons||[], thesis:s.thesis||null,
          headlines:(s.headlines||[]).slice(0,2),
        })),
        bySector:Object.fromEntries(Object.entries(bySector).map(([sec,stocks])=>[sec,
          stocks.map(s=>({sym:s.sym,name:s.name||s.sym,price:s.price,pct:s.pct,score:s.score,reasons:s.reasons||[]}))
        ])),
        totalQualified:scored.length,
      };
    }

    const output={generated:new Date().toISOString(),runType,macro,pickTypes};

    // Save to Gist
    const gr=await fetch(`https://api.github.com/gists/${PICKS_GIST}`,{
      method:'PATCH',
      headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
      body:JSON.stringify({files:{'enhanced_picks.json':{content:JSON.stringify(output)}}})
    });
    console.log('[picks] Gist saved:',gr.status);

    return send(200,{success:true,runType,macro,
      summary:{universe:universe.length,enriched:enriched.length,
        counts:Object.fromEntries(PICK_TYPES.map(k=>[k,pickTypes[k].overall.length]))}
    });

  } catch(e){
    console.error('[picks] Fatal:',e.message);
    return send(500,{error:e.message});
  }
}
