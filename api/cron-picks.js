export const config = { maxDuration: 300 };

const FINNHUB    = process.env.FINNHUB_KEY;
const POLYGON    = process.env.POLYGON_API_KEY;
const ANTHROPIC  = process.env.ANTHROPIC_API_KEY;
const GIST_TOKEN = process.env.GITHUB_TOKEN;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET;
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

const PICK_TYPES = {
  growth:   {label:'Long-Term Growth',  icon:'🌱', minScore:70, scoring:{momentum:15,fundamental:40,technical:20,quality:25}},
  momentum: {label:'Momentum / Swing',  icon:'🚀', minScore:65, scoring:{momentum:40,fundamental:20,technical:30,quality:10}},
  intraday: {label:'Intraday',          icon:'⚡', minScore:60, scoring:{momentum:35,fundamental:10,technical:35,quality:20}},
  general:  {label:'Best Opportunity',  icon:'🎯', minScore:68, scoring:{momentum:25,fundamental:25,technical:25,quality:25}},
};

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
  const c = closes.slice(-15);
  let g=0,l=0;
  for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];d>0?g+=d:l+=Math.abs(d);}
  const ag=g/14,al=l/14;
  return al===0?100:100-(100/(1+ag/al));
}

async function getUniverse() {
  if(!POLYGON) return [];
  const d = new Date();
  if(d.getDay()===0) d.setDate(d.getDate()-2);
  if(d.getDay()===6) d.setDate(d.getDate()-1);
  const dt = d.toISOString().split('T')[0];
  const data = await sf(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dt}?adjusted=true&apiKey=${POLYGON}`,15000);
  if(!data?.results) return [];
  return data.results
    .filter(s=>s.T&&s.T.length<=5&&!/[^A-Z]/.test(s.T)&&s.v>=500000&&s.c>=5&&s.c<=3000&&s.vw>0)
    .map(s=>({sym:s.T,price:s.c,open:s.o,high:s.h,low:s.l,volume:s.v,vwap:s.vw,pct:((s.c-s.o)/s.o*100)}))
    .sort((a,b)=>b.volume-a.volume)
    .slice(0,500);
}

async function enrich(stock) {
  const sym = stock.sym;
  const today = new Date().toISOString().split('T')[0];
  const past3 = new Date(Date.now()-3*86400000).toISOString().split('T')[0];
  const past90= new Date(Date.now()-90*86400000).toISOString().split('T')[0];

  const [metrics, candles, news, profile] = await Promise.all([
    sf(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB}`,5000),
    sf(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${past90}/${today}?adjusted=true&sort=desc&limit=90&apiKey=${POLYGON}`,6000),
    sf(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${past3}&to=${today}&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB}`,4000),
  ]);

  const m = metrics?.metric||{};
  const closes = candles?.results ? [...candles.results].reverse().map(c=>c.c) : [];
  const vols   = candles?.results ? [...candles.results].reverse().map(c=>c.v) : [];

  const s20=calcSMA(closes,20), s50=calcSMA(closes,50), s200=calcSMA(closes,200);
  const rsi=calcRSI(closes);
  const avgVol=calcSMA(vols,20);
  const volRatio=avgVol&&stock.volume?stock.volume/avgVol:null;
  const price1M=closes.length>=22?closes[closes.length-22]:null;
  const pct1M=price1M?((stock.price-price1M)/price1M):null;
  const recentNews=(news||[]).slice(0,5).map(n=>n.headline);

  return {
    ...stock,
    name:profile?.name||sym,
    sector:profile?.finnhubIndustry||'Unknown',
    marketCap:profile?.marketCapitalization?profile.marketCapitalization*1e6:null,
    sma20:s20,sma50:s50,sma200:s200,rsi,volRatio,
    above20MA:s20?stock.price>s20:null,
    above50MA:s50?stock.price>s50:null,
    above200MA:s200?stock.price>s200:null,
    vs20MA:s20?(stock.price-s20)/s20*100:null,
    vs50MA:s50?(stock.price-s50)/s50*100:null,
    vs200MA:s200?(stock.price-s200)/s200*100:null,
    pct1M,
    revGrowth:m.revenueGrowthTTMYoy, grossMargin:m.grossMarginTTM,
    netMargin:m.netProfitMarginAnnual, pe:m.peBasicExclExtraTTM,
    roe:m.roeTTM, beta:m.beta, eps:m.epsBasicExclExtraAnnual,
    shortRatio:m.shortRatio,
    hasNews:recentNews.length>0, headlines:recentNews,
  };
}

function scoreStock(s, ptKey, macro) {
  const w = PICK_TYPES[ptKey].scoring;
  const reasons = [];

  // MOMENTUM
  let mom = 50;
  if(s.pct>2){mom+=18;reasons.push(`+${s.pct.toFixed(1)}% today`);}
  else if(s.pct>0){mom+=8;}
  else if(s.pct<-2){mom-=15;}
  if(s.pct1M>0.15){mom+=18;reasons.push(`+${(s.pct1M*100).toFixed(0)}% 1-month`);}
  else if(s.pct1M>0.05){mom+=10;}
  else if(s.pct1M<-0.05){mom-=12;}
  if(s.above50MA) mom+=8;
  if(s.above200MA) mom+=6;
  if(macro.riskOn&&s.pct>0) mom+=5;
  mom=Math.max(0,Math.min(100,mom));

  // FUNDAMENTAL
  let fund = 50;
  if(s.revGrowth>0.20){fund+=20;reasons.push(`Rev +${(s.revGrowth*100).toFixed(0)}%`);}
  else if(s.revGrowth>0.10){fund+=12;}
  else if(s.revGrowth>0.05){fund+=6;}
  else if(s.revGrowth<0){fund-=10;}
  if(s.grossMargin>0.50){fund+=12;}
  else if(s.grossMargin>0.30){fund+=6;}
  if(s.netMargin>0.15){fund+=10;reasons.push(`${(s.netMargin*100).toFixed(0)}% margin`);}
  else if(s.netMargin>0.05){fund+=5;}
  else if(s.netMargin<0){fund-=15;}
  if(s.roe>0.20){fund+=8;}
  if(s.pe&&s.pe>0&&s.pe<20){fund+=8;reasons.push(`P/E ${s.pe.toFixed(1)}x`);}
  else if(s.pe&&s.pe>60){fund-=8;}
  if(s.eps>0){fund+=5;}
  fund=Math.max(0,Math.min(100,fund));

  // TECHNICAL
  let tech = 50;
  if(s.rsi){
    const r=parseFloat(s.rsi);
    if(r<30){tech+=20;reasons.push(`RSI ${r.toFixed(0)} oversold`);}
    else if(r<45){tech+=10;}
    else if(r>=45&&r<=60){tech+=15;reasons.push(`RSI ${r.toFixed(0)} healthy`);}
    else if(r>73){tech-=18;}
    else if(r>65){tech-=8;}
  }
  if(s.above20MA&&s.above50MA&&s.above200MA){tech+=20;reasons.push('Above all MAs');}
  else if(s.above50MA&&s.above200MA){tech+=12;}
  else if(!s.above50MA&&!s.above200MA){tech-=15;}
  if(s.volRatio>1.5){tech+=10;reasons.push(`${s.volRatio.toFixed(1)}x vol`);}
  else if(s.volRatio<0.5){tech-=8;}
  tech=Math.max(0,Math.min(100,tech));

  // QUALITY
  let qual = 50;
  if(s.marketCap>50e9){qual+=15;}
  else if(s.marketCap>10e9){qual+=8;}
  else if(s.marketCap<2e9){qual-=10;}
  if(s.beta&&s.beta<1.2){qual+=8;}
  else if(s.beta&&s.beta>2.5){qual-=10;}
  if(s.shortRatio&&s.shortRatio>10){qual-=15;}
  if(s.hasNews){qual+=8;}
  qual=Math.max(0,Math.min(100,qual));

  let score=(mom*w.momentum+fund*w.fundamental+tech*w.technical+qual*w.quality)/100;

  // Pick-type specific filters
  if(ptKey==='growth'){
    if(!s.above200MA) score*=0.5;
    if((s.revGrowth||0)<0.08) score*=0.75;
    if((s.grossMargin||0)<0.30) score*=0.8;
    if((s.marketCap||0)<5e9) score*=0.7;
  }
  if(ptKey==='momentum'){
    if(!s.above50MA) score*=0.6;
    if(!s.above20MA) score*=0.7;
    if((s.pct1M||0)<0.03) score*=0.7;
  }
  if(ptKey==='intraday'){
    if(s.volume<2e6) score*=0.5;
    if(!s.hasNews) score*=0.75;
    if(s.rsi){const r=parseFloat(s.rsi);if(r<25||r>75)score*=0.6;}
  }
  if(ptKey==='general'){
    if(!s.above50MA) score*=0.65;
    if((s.marketCap||0)<2e9) score*=0.7;
  }

  // Macro alignment bonus
  const growthSectors=['Technology','Consumer Cyclical','Communication Services'];
  const defensiveSectors=['Healthcare','Consumer Defensive','Utilities'];
  if(macro.riskOn&&growthSectors.includes(s.sector)) score*=1.05;
  if(!macro.riskOn&&defensiveSectors.includes(s.sector)) score*=1.05;

  return {score:Math.min(100,Math.round(score*10)/10), reasons:reasons.slice(0,3)};
}

async function generateThesis(pick, ptKey, macro) {
  if(!ANTHROPIC) return pick.reasons.join('. ')+'.';
  const cfg = PICK_TYPES[ptKey];
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001', max_tokens:150,
        messages:[{role:'user',content:
          `You are PulseStock's chief analyst. Write a 2-sentence ${cfg.label} thesis for ${pick.sym} (${pick.name}, ${pick.sector}).
Market: SPY ${macro.spyPct}%, VIX ${macro.vix}, ${macro.riskOn?'risk-on':'risk-off'} environment.
Stock: $${pick.price.toFixed(2)}, ${pick.pct.toFixed(2)}% today, RSI ${pick.rsi||'N/A'}, score ${pick.score}/100.
Key signals: ${pick.reasons.join(', ')}.${pick.headlines[0]?' News: '+pick.headlines[0]:''}
Sentence 1: the core opportunity. Sentence 2: specific catalyst or setup with a price target. No questions. No disclaimers.`
        }]
      })
    });
    if(!r.ok) return pick.reasons.join('. ')+'.';
    const d = await r.json();
    return d.content?.[0]?.text?.trim()||pick.reasons.join('. ')+'.';
  } catch(e){ return pick.reasons.join('. ')+'.'; }
}

async function getMacro() {
  const [spy,vix,tlt] = await Promise.all([
    sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`,4000),
    sf(`https://finnhub.io/api/v1/quote?symbol=TLT&token=${FINNHUB}`,4000),
  ]);
  const spyPct=spy?.dp||0, vixVal=vix?.c||20;
  return {spyPct:spyPct.toFixed(2),vix:vixVal.toFixed(1),tltPct:(tlt?.dp||0).toFixed(2),riskOn:spyPct>0&&vixVal<22};
}

export default async function handler(req, res) {
  const send = (status, body) => {
    res.writeHead(status, CORS);
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if(req.method==='OPTIONS') return send(200, '');

  const secret  = req.query?.secret || '';
  const runType = req.query?.run || 'full';
  const provided = (req.headers?.authorization||'').replace('Bearer ','') || secret;
  const valid = (CRON_SECRET&&provided===CRON_SECRET)||provided==='pulsestock2026';
  if(!valid) return send(401, {error:'Unauthorized'});

  try {
    console.log('[picks] Run:',runType);
    let [universe,macro] = await Promise.all([getUniverse(),getMacro()]);
    console.log(`[picks] Universe: ${universe.length} | SPY: ${macro.spyPct}%`);
    // Fallback universe for weekends/holidays when Polygon has no data
    let finalUniverse = universe;
    if(!universe.length) {
      console.log('[picks] Polygon empty — using fallback universe');
      const FALLBACK = ['AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','JPM','V','UNH',
        'XOM','CVX','LLY','JNJ','ABBV','HD','PG','MA','MRK','PEP','COST','KO','BAC','WMT',
        'AVGO','TMO','CSCO','ACN','ABT','CRM','MCD','ADBE','PFE','DIS','NFLX','AMD','INTC',
        'GS','MS','CAT','DE','RTX','HON','BA','GE','LMT','UPS','FDX','WFC','C'];
      // Fetch quotes for fallback
      const fq = await Promise.all(FALLBACK.map(s=>sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));
      finalUniverse = FALLBACK.map((s,i)=>{
        const d=fq[i]; if(!d||!d.c) return null;
        return {sym:s,price:d.c,open:d.o||d.c,high:d.h||d.c,low:d.l||d.c,volume:d.v||1e6,vwap:d.c,pct:d.dp||0};
      }).filter(Boolean);
      console.log(`[picks] Fallback universe: ${finalUniverse.length} stocks`);
    }
    universe = finalUniverse;
    if(!universe.length) return send(500, {error:'No universe data'});

    // Enrich top 150 by volume in batches of 10
    const candidates = universe.slice(0,60);
    const enriched = [];
    for(let i=0;i<candidates.length;i+=5){
      const batch = candidates.slice(i,i+5);
      const results = await Promise.all(batch.map(s=>enrich(s).catch(()=>null)));
      enriched.push(...results.filter(Boolean));
      if(i+5<candidates.length) await new Promise(r=>setTimeout(r,300));
    }
    console.log(`[picks] Enriched: ${enriched.length}`);

    const output = {generated:new Date().toISOString(),runType,macro,pickTypes:{}};

    for(const [ptKey,ptCfg] of Object.entries(PICK_TYPES)){
      const scored = enriched
        .map(s=>{const{score,reasons}=scoreStock(s,ptKey,macro);return{...s,score,reasons};})
        .filter(s=>s.score>=ptCfg.minScore)
        .sort((a,b)=>b.score-a.score);

      // Top 5 per sector
      const bySector={};
      for(const s of scored){
        const sec=s.sector||'Unknown';
        if(!bySector[sec]) bySector[sec]=[];
        if(bySector[sec].length<5) bySector[sec].push(s);
      }

      // Overall top 5
      const overall=scored.slice(0,5);

      // AI thesis for top 2 picks
      for(let pi=0;pi<Math.min(2,overall.length);pi++){
        overall[pi].thesis = await generateThesis(overall[pi],ptKey,macro);
      }

      output.pickTypes[ptKey]={
        label:ptCfg.label, icon:ptCfg.icon,
        overall:overall.map(s=>({
          sym:s.sym,name:s.name,sector:s.sector,
          price:s.price,pct:s.pct,score:s.score,
          rsi:s.rsi?parseFloat(s.rsi).toFixed(0):null,
          above50MA:s.above50MA,above200MA:s.above200MA,
          sma50:s.sma50?s.sma50.toFixed(2):null,
          sma200:s.sma200?s.sma200.toFixed(2):null,
          reasons:s.reasons,thesis:s.thesis||null,
          headlines:(s.headlines||[]).slice(0,2),
        })),
        bySector:Object.fromEntries(Object.entries(bySector).map(([sec,stocks])=>[sec,
          stocks.map(s=>({sym:s.sym,name:s.name,price:s.price,pct:s.pct,score:s.score,reasons:s.reasons}))
        ])),
        totalQualified:scored.length,
      };
    }

    // Save to Gist
    await fetch(`https://api.github.com/gists/${PICKS_GIST}`,{
      method:'PATCH',
      headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
      body:JSON.stringify({files:{'enhanced_picks.json':{content:JSON.stringify(output)}}})
    });

    console.log('[picks] Done');
    return send(200, {
      success:true,runType,macro,
      summary:{enriched:enriched.length,
        counts:Object.fromEntries(Object.entries(output.pickTypes).map(([k,v])=>[k,v.overall.length]))}
    });

  } catch(e){
    console.error('[picks] Fatal:',e.message);
    return send(500, {error:e.message});
  }
}
