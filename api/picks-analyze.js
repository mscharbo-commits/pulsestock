export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON   = process.env.POLYGON_API_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

async function safeFetch(url, t=5000) {
  try {
    const ctrl=new AbortController(), id=setTimeout(()=>ctrl.abort(),t);
    const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(id);
    if(!r.ok) return null; return await r.json();
  } catch(e){ return null; }
}

const SECTOR_ETF = {
  'Technology':'XLK','Semiconductors':'XLK','Software':'XLK','Electronic Technology':'XLK',
  'Financial Services':'XLF','Banks':'XLF','Banking':'XLF','Finance':'XLF',
  'Energy':'XLE','Oil & Gas':'XLE','Energy Minerals':'XLE',
  'Healthcare':'XLV','Biotechnology':'XLV','Pharmaceuticals':'XLV','Health Technology':'XLV',
  'Industrials':'XLI','Aerospace & Defense':'XLI','Industrial Services':'XLI',
  'Consumer Cyclical':'XLY','Retail Trade':'XLY','Consumer Services':'XLY',
  'Consumer Defensive':'XLP','Consumer Non-Durables':'XLP',
  'Communication Services':'XLC','Media':'XLC','Telecommunications':'XLC',
  'Real Estate':'XLRE','Utilities':'XLU','Basic Materials':'XLB','Non-Energy Minerals':'XLB',
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

    // Step 1: Get profile first to determine sector ETF
    const profile = await safeFetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`);
    const sector  = profile?.finnhubIndustry || 'Unknown';
    const sectorEtf = SECTOR_ETF[sector] || null;

    // Step 2: Fetch all data in parallel — SAME as analyze-cached
    const [quote, metrics, news, spy, qqq, vix, sectorQ, sectorNews, polySnap] = await Promise.all([
      safeFetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
      safeFetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`),
      safeFetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${weekAgo}&to=${today}&token=${FINNHUB}`),
      safeFetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB}`),
      safeFetch(`https://finnhub.io/api/v1/quote?symbol=QQQ&token=${FINNHUB}`),
      safeFetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB}`),
      sectorEtf ? safeFetch(`https://finnhub.io/api/v1/quote?symbol=${sectorEtf}&token=${FINNHUB}`) : null,
      sectorEtf ? safeFetch(`https://finnhub.io/api/v1/company-news?symbol=${sectorEtf}&from=${weekAgo}&to=${today}&token=${FINNHUB}`) : null,
      POLYGON ? safeFetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON}`) : null,
    ]);

    // Step 3: Build context — SAME as analyze-cached
    const parts = [];

    if(quote?.c) {
      parts.push(`=== ${ticker} CURRENT DATA ===`);
      parts.push(`Price: $${quote.c.toFixed(2)} | Change: ${quote.dp>=0?'+':''}${quote.dp?.toFixed(2)}% ($${quote.d?.toFixed(2)}) | High: $${quote.h} | Low: $${quote.l} | Open: $${quote.o} | Prev Close: $${quote.pc}`);
    }
    if(profile?.name) {
      parts.push(`Company: ${profile.name} | Sector: ${sector} | Industry: ${profile.finnhubIndustry} | Market Cap: $${profile.marketCapitalization?(profile.marketCapitalization/1000).toFixed(1)+'B':'N/A'} | Exchange: ${profile.exchange}`);
    }
    if(polySnap?.ticker?.day) {
      const d=polySnap.ticker.day;
      parts.push(`Volume: ${d.v?.toLocaleString()} | VWAP: $${d.vw?.toFixed(2)}`);
    }
    if(metrics?.metric) {
      const m=metrics.metric;
      const mp=[
        m.peBasicExclExtraTTM?`P/E TTM: ${m.peBasicExclExtraTTM.toFixed(1)}x`:'',
        m.epsBasicExclExtraAnnual?`EPS: $${m.epsBasicExclExtraAnnual.toFixed(2)}`:'',
        m.revenueGrowthTTMYoy?`Rev Growth: ${(m.revenueGrowthTTMYoy*100).toFixed(1)}%`:'',
        m.grossMarginTTM?`Gross Margin: ${m.grossMarginTTM.toFixed(1)}%`:'',
        m.netProfitMarginAnnual?`Net Margin: ${m.netProfitMarginAnnual.toFixed(1)}%`:'',
        m['52WeekHigh']?`52W Range: $${m['52WeekLow']} - $${m['52WeekHigh']}`:'',
        m.beta?`Beta: ${m.beta.toFixed(2)}`:'',
        m.rsi14?`RSI14: ${m.rsi14.toFixed(0)}`:'',
        m.roeTTM?`ROE: ${(m.roeTTM*100).toFixed(1)}%`:'',
      ].filter(Boolean).join(' | ');
      if(mp) parts.push(`Fundamentals: ${mp}`);
    }
    if(news?.length) {
      parts.push(`\n=== ${ticker} RECENT NEWS (last 7 days) ===`);
      news.slice(0,5).forEach(n=>parts.push(`• ${n.headline} (${new Date(n.datetime*1000).toLocaleDateString()})`));
    }
    if(sectorEtf&&sectorQ?.c) {
      parts.push(`\n=== SECTOR PERFORMANCE (${sector}) ===`);
      parts.push(`${sectorEtf} ETF: $${sectorQ.c.toFixed(2)} | ${sectorQ.dp>=0?'+':''}${sectorQ.dp?.toFixed(2)}% today`);
      if(sectorNews?.length) {
        parts.push(`Sector News:`);
        sectorNews.slice(0,3).forEach(n=>parts.push(`• ${n.headline}`));
      }
    }
    parts.push(`\n=== BROAD MARKET CONTEXT ===`);
    if(spy?.c) parts.push(`SPY: $${spy.c.toFixed(2)} | ${spy.dp>=0?'+':''}${spy.dp?.toFixed(2)}% — ${spy.dp>0.5?'Risk-On':spy.dp<-0.5?'Risk-Off':'Neutral'}`);
    if(qqq?.c) parts.push(`QQQ: $${qqq.c.toFixed(2)} | ${qqq.dp>=0?'+':''}${qqq.dp?.toFixed(2)}%`);
    if(vix?.c) parts.push(`VIX: ${vix.c.toFixed(1)} — ${vix.c>25?'High Fear':vix.c>18?'Elevated Volatility':'Low Fear'}`);

    const contextData = parts.join('\n');

    const price = quote?.c || 0;
    const pct   = quote?.dp || 0;

    if(!ANTHROPIC) {
      return new Response(JSON.stringify({
        ticker, sym:ticker, name:profile?.name||ticker, sector,
        price, pct, rating:'WATCH', score:50,
        thesis:`${ticker} — AI analysis unavailable.`,
        keySignals:[], target:null, stopLoss:null
      }),{headers:CORS});
    }

    const PICK_TYPE_CONTEXT = {
      growth: `LONG-TERM GROWTH pick (12-month horizon). BUY only if: revenue growth >10% YoY, expanding margins, durable moat, trading below analyst target. AVOID if: revenue declining, margins compressing, or no growth justification. Target = 12-month price target. Stop = key support.`,
      momentum: `MOMENTUM/SWING TRADE (5-30 day). BUY only if: strong relative strength vs SPY, constructive RSI (45-65), above key moving averages, clear technical catalyst. AVOID if: broken trend, below MAs, overbought >75 RSI. Target = next resistance. Stop = recent swing low.`,
      intraday: `INTRADAY TRADE (same day only). BUY only if: clear news catalyst TODAY, elevated volume vs average, holding above VWAP. AVOID if: no same-day catalyst, low volume, or pre-market move already faded. Target = 2-3% above price. Stop = VWAP or morning low.`,
      general: `BEST OVERALL OPPORTUNITY today (any timeframe). BUY if strong risk/reward with at least one clear edge — fundamental, technical, or catalyst. AVOID if no clear edge or risk outweighs reward.`,
    };

    const aiResp = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001',
        max_tokens:400,
        system:`You are a senior institutional stock analyst creating a morning picks rating.
${PICK_TYPE_CONTEXT[pickType]||PICK_TYPE_CONTEXT.general}

Analyze the provided market data and rate this stock.

RATING RULES:
- BUY: Stock has clear positive catalyst, favorable technicals OR strong fundamentals, good risk/reward. Conviction required.
- AVOID: Weak setup, poor risk/reward, data issues, or no clear edge today.
- Never return WATCH. If uncertain between BUY and AVOID, choose AVOID.
- If price data is missing or $0, you may still rate BUY if fundamentals and news are strongly positive.

Respond ONLY with valid JSON — no other text:
{
  "rating": "BUY" | "AVOID",
  "score": <integer 0-100>,
  "thesis": "<2 sharp sentences with specific data points. Sentence 1: core opportunity or risk. Sentence 2: specific catalyst or level with price target if BUY.>",
  "keySignals": ["<specific signal with number>", "<specific signal with number>", "<specific signal with number>"],
  "target": "<price target based on real data, or null>",
  "stopLoss": "<stop loss level based on real data, or null>",
  "timeframe": "<specific timeframe>"
}`,
        messages:[{role:'user',content:`${contextData}\n\nRate ${ticker} as a ${pickType} pick. Return JSON only.`}]
      })
    });

    if(!aiResp.ok) throw new Error('AI error: '+aiResp.status);
    const aiData = await aiResp.json();
    const rawText = aiData.content?.[0]?.text||'{}';

    let parsed;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0]||'{}');
    } catch(e) {
      parsed = {rating:'AVOID',score:40,thesis:rawText.slice(0,200),keySignals:[],target:null,stopLoss:null};
    }

    return new Response(JSON.stringify({
      ticker, sym:ticker,
      name:     profile?.name||ticker,
      sector,
      price,
      pct,
      volume:   polySnap?.ticker?.day?.v || 0,
      rating:   parsed.rating||'AVOID',
      score:    parsed.score||40,
      thesis:   parsed.thesis||'',
      keySignals: parsed.keySignals||[],
      target:   parsed.target||null,
      stopLoss: parsed.stopLoss||null,
      timeframe:parsed.timeframe||null,
      // Pass through for technicals display
      rsi:      metrics?.metric?.rsi14||null,
      sma50:    null, // not available without candles
      sma200:   null,
    }), {headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message,ticker,sym:ticker}),{status:500,headers:CORS});
  }
}
