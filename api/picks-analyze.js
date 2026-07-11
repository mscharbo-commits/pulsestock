export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON   = process.env.POLYGON_API_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

async function sf(url, t=5000) {
  try {
    const ctrl=new AbortController(), id=setTimeout(()=>ctrl.abort(),t);
    const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(id);
    if(!r.ok) return null; return await r.json();
  } catch(e){ return null; }
}

const SECTOR_ETF = {
  'Technology':'XLK','Semiconductors':'XLK','Software':'XLK',
  'Financial Services':'XLF','Banks':'XLF',
  'Energy':'XLE','Oil & Gas':'XLE',
  'Healthcare':'XLV','Biotechnology':'XLV','Pharmaceuticals':'XLV',
  'Industrials':'XLI','Aerospace & Defense':'XLI',
  'Consumer Cyclical':'XLY','Retail':'XLY',
  'Consumer Defensive':'XLP','Communication Services':'XLC',
  'Real Estate':'XLRE','Utilities':'XLU','Basic Materials':'XLB',
};

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  const {searchParams} = new URL(req.url);
  const ticker = (searchParams.get('ticker')||'').toUpperCase().trim();
  const pickType = searchParams.get('type')||'general';

  if(!ticker) return new Response(JSON.stringify({error:'No ticker'}),{status:400,headers:CORS});

  try {
    const today   = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
    const past90  = new Date(Date.now()-90*86400000).toISOString().split('T')[0];

    // Fetch all data in parallel
    const [profile, quote, metrics, news, spy, vix, candles] = await Promise.all([
      sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`),
      sf(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
      sf(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`),
      sf(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${weekAgo}&to=${today}&token=${FINNHUB}`),
      sf(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`),
      sf(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`),
      POLYGON ? sf(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${past90}/${today}?adjusted=true&sort=desc&limit=90&apiKey=${POLYGON}`) : null,
    ]);

    const m = metrics?.metric||{};
    const sector = profile?.finnhubIndustry||'Unknown';
    const sectorEtf = SECTOR_ETF[sector];

    // Calculate technicals from candles
    let sma20=null,sma50=null,sma200=null,rsi=null,volRatio=null,pct1M=null;
    if(candles?.results?.length) {
      const closes = [...candles.results].reverse().map(c=>c.c);
      const vols   = [...candles.results].reverse().map(c=>c.v);
      const price  = quote?.c||0;
      if(closes.length>=20) sma20=(closes.slice(-20).reduce((a,b)=>a+b,0)/20);
      if(closes.length>=50) sma50=(closes.slice(-50).reduce((a,b)=>a+b,0)/50);
      if(closes.length>=200) sma200=(closes.slice(-200).reduce((a,b)=>a+b,0)/200);
      if(closes.length>=22) pct1M=((price-(closes[closes.length-22]))/(closes[closes.length-22])*100);
      if(closes.length>=15){
        const c=closes.slice(-15); let g=0,l=0;
        for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];d>0?g+=d:l+=Math.abs(d);}
        const ag=g/14,al=l/14; rsi=al===0?100:100-(100/(1+ag/al));
      }
      const avgVol=vols.slice(-20).reduce((a,b)=>a+b,0)/20;
      if(avgVol&&candles.results[0].v) volRatio=candles.results[0].v/avgVol;
    }

    const price = quote?.c||0;
    // Note: price may be 0 on weekends/after hours — analysis still runs

    // Build context for Claude
    const context = [
      `STOCK: ${ticker} — ${profile?.name||ticker} (${sector})`,
      `Price: $${price.toFixed(2)} | Change: ${quote?.dp>=0?'+':''}${(quote?.dp||0).toFixed(2)}% | Volume: ${(quote?.v||0).toLocaleString()}`,
      `Market Cap: ${profile?.marketCapitalization?(profile.marketCapitalization/1000).toFixed(1)+'B':'N/A'}`,
      '',
      `TECHNICALS:`,
      `SMA20: ${sma20?'$'+sma20.toFixed(2)+' ('+((price-sma20)/sma20*100).toFixed(1)+'% vs price)':'N/A'}`,
      `SMA50: ${sma50?'$'+sma50.toFixed(2)+' ('+((price-sma50)/sma50*100).toFixed(1)+'% vs price)':'N/A'}`,
      `SMA200: ${sma200?'$'+sma200.toFixed(2)+' ('+((price-sma200)/sma200*100).toFixed(1)+'% vs price)':'N/A'}`,
      `RSI(14): ${rsi?rsi.toFixed(0):'N/A'}`,
      `Volume ratio: ${volRatio?volRatio.toFixed(2)+'x avg':'N/A'}`,
      `1-month return: ${pct1M?pct1M.toFixed(1)+'%':'N/A'}`,
      '',
      `FUNDAMENTALS:`,
      `P/E TTM: ${m.peBasicExclExtraTTM?m.peBasicExclExtraTTM.toFixed(1)+'x':'N/A'}`,
      `EPS: ${m.epsBasicExclExtraAnnual?'$'+m.epsBasicExclExtraAnnual.toFixed(2):'N/A'}`,
      `Revenue Growth YoY: ${m.revenueGrowthTTMYoy?(m.revenueGrowthTTMYoy*100).toFixed(1)+'%':'N/A'}`,
      `Gross Margin: ${m.grossMarginTTM?m.grossMarginTTM.toFixed(1)+'%':'N/A'}`,
      `Net Margin: ${m.netProfitMarginAnnual?m.netProfitMarginAnnual.toFixed(1)+'%':'N/A'}`,
      `Beta: ${m.beta?m.beta.toFixed(2):'N/A'}`,
      `52W Range: ${m['52WeekLow']&&m['52WeekHigh']?'$'+m['52WeekLow']+' - $'+m['52WeekHigh']:'N/A'}`,
      '',
      `MARKET CONTEXT:`,
      `SPY: ${spy?.dp>=0?'+':''}${(spy?.dp||0).toFixed(2)}% | VIX: ${(vix?.c||20).toFixed(1)}`,
      sectorEtf?`Sector ETF (${sectorEtf}): check for sector strength`:'',
      '',
      `RECENT NEWS:`,
      ...(news||[]).slice(0,5).map(n=>`• ${n.headline}`),
    ].filter(s=>s!==undefined).join('\n');

    const pickTypePrompts = {
      growth:   'Evaluate as a LONG-TERM GROWTH pick. Focus on: durable competitive advantage, revenue growth trajectory, margin expansion, market leadership. 12-month horizon.',
      momentum: 'Evaluate as a MOMENTUM/SWING TRADE. Focus on: price momentum, technical breakout, catalyst, relative strength. 5-30 day horizon.',
      intraday: 'Evaluate as an INTRADAY trade. Focus on: today\'s catalyst, volume confirmation, key intraday levels, liquidity. Same-day horizon.',
      general:  'Evaluate as the BEST OVERALL OPPORTUNITY today balancing risk/reward across any timeframe.',
    };

    if(!ANTHROPIC) {
      return new Response(JSON.stringify({
        ticker, rating:'WATCH', score:50,
        thesis:`${ticker} flagged for review — AI analysis unavailable.`,
        keySignals:['Technical review needed','Fundamental analysis needed'],
        target:(price*1.05).toFixed(2), stopLoss:(price*0.95).toFixed(2),
        sector, price, pct:quote?.dp||0, sma50, sma200, rsi, pct1M
      }),{headers:CORS});
    }

    const aiResp = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:400,
        system:`You are a senior institutional analyst rating stocks for a morning picks report.
${pickTypePrompts[pickType]||pickTypePrompts.general}

CRITICAL RULES:
- Return ONLY "BUY" or "AVOID" for rating. Never "WATCH". If you are unsure, return "AVOID".
- BUY requires: strong fundamentals OR clear technical setup OR compelling catalyst. At least one must be present with real data.
- AVOID means: weak fundamentals, poor technicals, high risk, missing data, or no clear edge.
- If price data is missing or zero, return AVOID with score below 40.
- Never invent price targets without a real current price to anchor from.
- keySignals must be 3 specific, factual observations — not generic statements.
- thesis must be 2 sharp sentences with specific numbers. No hedging. No disclaimers.

Respond ONLY with valid JSON:
{
  "rating": "BUY" | "AVOID",
  "score": <integer 0-100>,
  "thesis": "<2 sharp sentences with specific numbers>",
  "keySignals": ["<specific signal 1>", "<specific signal 2>", "<specific signal 3>"],
  "target": "<price target anchored to current price>",
  "stopLoss": "<stop loss level>",
  "timeframe": "<specific timeframe>"
}`,
        messages:[{role:'user',content:`${context}\n\nRate this stock as a ${pickType} pick. Return JSON only.`}]
      })
    });

    if(!aiResp.ok) throw new Error('AI error: '+aiResp.status);
    const aiData = await aiResp.json();
    const rawText = aiData.content?.[0]?.text||'{}';

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0]||'{}');
    } catch(e) {
      parsed = {rating:'WATCH',score:50,thesis:rawText.slice(0,200),keySignals:[],target:null,stopLoss:null};
    }

    return new Response(JSON.stringify({
      ticker, sym:ticker, sector, price, pct:quote?.dp||0,
      sma20, sma50, sma200, rsi, volRatio, pct1M,
      name: profile?.name||ticker,
      rating:   parsed.rating||'WATCH',
      score:    parsed.score||50,
      thesis:   parsed.thesis||'',
      keySignals: parsed.keySignals||[],
      target:   parsed.target||null,
      stopLoss: parsed.stopLoss||null,
      timeframe:parsed.timeframe||null,
    }), {headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message,ticker}),{status:500,headers:CORS});
  }
}
