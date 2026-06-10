export const config = { runtime: 'edge', maxDuration: 300 };

const GIST_TOKEN = process.env.GITHUB_TOKEN;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET;

const UNIVERSE = [
  {sym:'AAPL',name:'Apple',sector:'Tech'},{sym:'MSFT',name:'Microsoft',sector:'Tech'},
  {sym:'NVDA',name:'Nvidia',sector:'Tech'},{sym:'GOOGL',name:'Alphabet',sector:'Tech'},
  {sym:'META',name:'Meta',sector:'Tech'},{sym:'AMZN',name:'Amazon',sector:'Tech'},
  {sym:'JPM',name:'JPMorgan',sector:'Finance'},{sym:'GS',name:'Goldman Sachs',sector:'Finance'},
  {sym:'BAC',name:'Bank of America',sector:'Finance'},{sym:'V',name:'Visa',sector:'Finance'},
  {sym:'UNH',name:'UnitedHealth',sector:'Healthcare'},{sym:'LLY',name:'Eli Lilly',sector:'Healthcare'},
  {sym:'JNJ',name:'Johnson & Johnson',sector:'Healthcare'},{sym:'ABBV',name:'AbbVie',sector:'Healthcare'},
  {sym:'XOM',name:'ExxonMobil',sector:'Energy'},{sym:'CVX',name:'Chevron',sector:'Energy'},
  {sym:'OXY',name:'Occidental',sector:'Energy'},
  {sym:'TSLA',name:'Tesla',sector:'Consumer'},{sym:'WMT',name:'Walmart',sector:'Consumer'},
  {sym:'HD',name:'Home Depot',sector:'Consumer'},{sym:'NKE',name:'Nike',sector:'Consumer'},
  {sym:'MCD',name:"McDonald's",sector:'Consumer'},
  {sym:'CAT',name:'Caterpillar',sector:'Industrial'},{sym:'BA',name:'Boeing',sector:'Industrial'},
  {sym:'GE',name:'GE Aerospace',sector:'Industrial'},
  {sym:'AMD',name:'AMD',sector:'Semi'},{sym:'TSM',name:'TSMC',sector:'Semi'},
  {sym:'INTC',name:'Intel',sector:'Semi'},
  {sym:'SPY',name:'S&P 500 ETF',sector:'Index'},{sym:'QQQ',name:'Nasdaq ETF',sector:'Index'},
];

// Macro indicators to fetch once
async function getMacroContext() {
  try {
    const [spy, qqq, vix, tlt, uup] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB_KEY}`).then(r=>r.json()),
      fetch(`https://finnhub.io/api/v1/quote?symbol=QQQ&token=${FINNHUB_KEY}`).then(r=>r.json()),
      fetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB_KEY}`).then(r=>r.json()),
      fetch(`https://finnhub.io/api/v1/quote?symbol=TLT&token=${FINNHUB_KEY}`).then(r=>r.json()),
      fetch(`https://finnhub.io/api/v1/quote?symbol=UUP&token=${FINNHUB_KEY}`).then(r=>r.json()),
    ]);
    return {
      spyPct: spy.dp?.toFixed(2) || 0,
      qqqPct: qqq.dp?.toFixed(2) || 0,
      vix: vix.c?.toFixed(1) || 'N/A',
      tltPct: tlt.dp?.toFixed(2) || 0,
      uupPct: uup.dp?.toFixed(2) || 0,
      riskOn: (spy.dp || 0) > 0 && (vix.c || 20) < 20,
    };
  } catch(e) { return {spyPct:0,qqqPct:0,vix:'N/A',tltPct:0,uupPct:0,riskOn:false}; }
}

async function getStockData(sym) {
  const to = new Date().toISOString().split('T')[0];
  const from30 = new Date(Date.now()-30*86400000).toISOString().split('T')[0];
  const from3 = new Date(Date.now()-3*86400000).toISOString().split('T')[0];

  const [quote, candles, news, metrics, analyst] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`).then(r=>r.json()).catch(()=>({})),
    fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${sym}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}&token=${FINNHUB_KEY}`).then(r=>r.json()).catch(()=>({})),
    fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from3}&to=${to}&token=${FINNHUB_KEY}`).then(r=>r.json()).catch(()=>[]),
    fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`).then(r=>r.json()).catch(()=>({})),
    fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${FINNHUB_KEY}`).then(r=>r.json()).catch(()=>[]),
  ]);

  // Calculate simple technicals from candles
  const closes = candles.c || [];
  const sma20 = closes.length >= 20 ? (closes.slice(-20).reduce((a,b)=>a+b,0)/20).toFixed(2) : null;
  const sma50 = closes.length >= 50 ? (closes.slice(-50).reduce((a,b)=>a+b,0)/50).toFixed(2) : null;
  const high52 = closes.length ? Math.max(...closes).toFixed(2) : null;
  const low52 = closes.length ? Math.min(...closes).toFixed(2) : null;
  const pct52 = high52 && low52 ? (((quote.c - parseFloat(low52))/(parseFloat(high52)-parseFloat(low52)))*100).toFixed(0) : null;

  // RSI (14-day simplified)
  let rsi = null;
  if (closes.length >= 15) {
    const gains = [], losses = [];
    for (let i = closes.length-14; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }
    const avgGain = gains.reduce((a,b)=>a+b,0)/14;
    const avgLoss = losses.reduce((a,b)=>a+b,0)/14;
    rsi = avgLoss === 0 ? 100 : (100 - 100/(1+avgGain/avgLoss)).toFixed(1);
  }

  const m = metrics.metric || {};
  const latestAnalyst = analyst[0] || {};
  const headlines = (news||[]).slice(0,6).map(n=>n.headline).join(' | ');

  return {
    price: quote.c || 0, change: quote.d || 0, pct: quote.dp || 0,
    high: quote.h, low: quote.l, prevClose: quote.pc,
    // Technicals
    sma20, sma50, rsi, high52, low52, pct52,
    aboveSma20: sma20 && quote.c > parseFloat(sma20),
    aboveSma50: sma50 && quote.c > parseFloat(sma50),
    // Fundamentals
    pe: m['peNormalizedAnnual'] || m['peTTM'],
    pb: m['pbAnnual'],
    roe: m['roeTTM'],
    eps: m['epsTTM'],
    revenueGrowth: m['revenueGrowthTTMYoy'],
    grossMargin: m['grossMarginTTM'],
    debtEquity: m['totalDebt/totalEquityAnnual'],
    beta: m['beta'],
    div: m['dividendYieldIndicatedAnnual'],
    // Analyst
    analystBuy: (latestAnalyst.strongBuy||0) + (latestAnalyst.buy||0),
    analystHold: latestAnalyst.hold||0,
    analystSell: (latestAnalyst.sell||0) + (latestAnalyst.strongSell||0),
    analystTarget: m['targetMean'],
    // News
    headlines,
  };
}

async function analyzePick(stock, d, macro) {
  const technicalSignal = d.rsi
    ? (parseFloat(d.rsi) < 35 ? 'Oversold (RSI '+d.rsi+')' : parseFloat(d.rsi) > 70 ? 'Overbought (RSI '+d.rsi+')' : 'Neutral (RSI '+d.rsi+')')
    : 'RSI unavailable';

  const trend = d.aboveSma20 && d.aboveSma50 ? 'Above both 20 & 50-day MA (bullish)' :
                d.aboveSma20 ? 'Above 20-day but below 50-day MA (mixed)' :
                d.aboveSma50 ? 'Below 20-day but above 50-day MA (weakening)' : 'Below both MAs (bearish)';

  const analystSentiment = d.analystBuy > 0
    ? `${d.analystBuy} buy / ${d.analystHold} hold / ${d.analystSell} sell`
    : 'No analyst data';

  const prompt = `You are PulseStock's chief market analyst. Generate a morning pick rating for ${stock.sym} (${stock.name}, ${stock.sector} sector).

MACRO ENVIRONMENT (pre-market):
- S&P 500: ${macro.spyPct}% | Nasdaq: ${macro.qqqPct}% | VIX: ${macro.vix} | Bonds (TLT): ${macro.tltPct}% | USD: ${macro.uupPct}%
- Market sentiment: ${macro.riskOn ? 'Risk-ON (favorable for equities)' : 'Risk-OFF (caution warranted)'}

TECHNICAL ANALYSIS:
- Price: $${d.price.toFixed(2)} | Change: ${d.pct > 0 ? '+' : ''}${d.pct.toFixed(2)}%
- Trend: ${trend}
- Momentum: ${technicalSignal}
- 52-week position: ${d.pct52 ? d.pct52+'% of 52-week range' : 'N/A'} (${d.low52} - ${d.high52})

FUNDAMENTAL ANALYSIS:
- P/E: ${d.pe ? d.pe.toFixed(1)+'x' : 'N/A'} | P/B: ${d.pb ? d.pb.toFixed(1)+'x' : 'N/A'} | ROE: ${d.roe ? d.roe.toFixed(1)+'%' : 'N/A'}
- Revenue Growth YoY: ${d.revenueGrowth ? d.revenueGrowth.toFixed(1)+'%' : 'N/A'} | Gross Margin: ${d.grossMargin ? d.grossMargin.toFixed(1)+'%' : 'N/A'}
- Beta: ${d.beta ? d.beta.toFixed(2) : 'N/A'} | Debt/Equity: ${d.debtEquity ? d.debtEquity.toFixed(2) : 'N/A'}

ANALYST CONSENSUS:
- ${analystSentiment}
- Price target: ${d.analystTarget ? '$'+d.analystTarget.toFixed(2) : 'N/A'}

RECENT NEWS (last 3 days):
${d.headlines || 'No recent news'}

Based on ALL factors above — macro environment, technical setup, fundamentals, analyst consensus, and news — provide your morning pick rating.

Respond in this EXACT JSON format only, no other text:
{"rating":"BUY","confidence":78,"reason":"Strong technical breakout above key MAs with bullish macro backdrop and positive earnings revision","target":${(d.price * 1.05).toFixed(2)},"technicalSignal":"${technicalSignal.split(' ')[0]}","fundamentalScore":"Strong","macroAlignment":"Favorable"}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:200,messages:[{role:'user',content:prompt}]})
    });
    const data = await resp.json();
    const text = (data?.content?.[0]?.text||'').trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch(e) {
    return {rating:'WATCH',confidence:50,reason:'Insufficient data for confident rating',target:d.price,technicalSignal:'N/A',fundamentalScore:'N/A',macroAlignment:'N/A'};
  }
}

async function saveGist(picks, performance) {
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  await fetch(`https://api.github.com/gists/${PICKS_GIST}`,{
    method:'PATCH',
    headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'Content-Type':'application/json','User-Agent':'PulseStock'},
    body:JSON.stringify({files:{'picks_cache.json':{content:JSON.stringify({date:today,generated:new Date().toISOString(),picks})}, 'picks_performance.json':{content:JSON.stringify(performance)}}}),
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const authHeader = req.headers.get('authorization') || '';
  const authQuery = url.searchParams.get('secret') || '';
  const token = authHeader.replace('Bearer ', '') || authQuery;
  if (token !== CRON_SECRET) return new Response(JSON.stringify({error:'Unauthorized - check your CRON_SECRET'}), {status:401, headers:{'Content-Type':'application/json'}});

  try {
    console.log('[cron-picks] Starting deep analysis...');

    // Get macro context once
    const macro = await getMacroContext();
    console.log('[cron-picks] Macro:', JSON.stringify(macro));

    const picks = [];
    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < UNIVERSE.length; i += 5) {
      const batch = UNIVERSE.slice(i, i+5);
      const results = await Promise.all(batch.map(async stock => {
        try {
          const d = await getStockData(stock.sym);
          if (!d.price) return null;
          const analysis = await analyzePick(stock, d, macro);
          return {
            sym: stock.sym, name: stock.name, sector: stock.sector,
            price: d.price, change: d.change, pct: d.pct,
            rsi: d.rsi, sma20: d.sma20, aboveSma20: d.aboveSma20, aboveSma50: d.aboveSma50,
            pe: d.pe, beta: d.beta,
            analystBuy: d.analystBuy, analystSell: d.analystSell,
            rating: analysis.rating, confidence: analysis.confidence,
            reason: analysis.reason, target: analysis.target,
            technicalSignal: analysis.technicalSignal,
            fundamentalScore: analysis.fundamentalScore,
            macroAlignment: analysis.macroAlignment,
            date: new Date().toISOString().split('T')[0],
            timestamp: Date.now(),
          };
        } catch(e) { console.error(`[cron-picks] Error on ${stock.sym}:`, e.message); return null; }
      }));
      picks.push(...results.filter(Boolean));
    }

    // Load + update performance log
    let performance = {picks:[]};
    try {
      const gr = await fetch(`https://api.github.com/gists/${PICKS_GIST}`,
        {headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'User-Agent':'PulseStock'}});
      const gd = await gr.json();
      performance = JSON.parse(gd?.files?.['picks_performance.json']?.content||'{}') || {picks:[]};
    } catch(e) {}

    const today = new Date().toISOString().split('T')[0];
    performance.picks = (performance.picks||[]).filter(p => p.date !== today);
    performance.picks.push(...picks.map(p => ({...p, priceAtPick: p.price})));
    // Keep 90 days
    const cutoff = Date.now() - 90*86400000;
    performance.picks = performance.picks.filter(p => new Date(p.date).getTime() > cutoff);

    // Summary stats
    const total = performance.picks.length;
    const buys = performance.picks.filter(p=>p.rating==='BUY').length;
    performance.summary = {total, buys, watches: performance.picks.filter(p=>p.rating==='WATCH').length, avoids: performance.picks.filter(p=>p.rating==='AVOID').length, buyPct: total ? ((buys/total)*100).toFixed(1) : 0};

    await saveGist(picks, performance);
    console.log(`[cron-picks] Complete — ${picks.length} picks`);
    return new Response(JSON.stringify({success:true,count:picks.length,macro,picks}), {headers:{'Content-Type':'application/json'}});
  } catch(e) {
    console.error('[cron-picks] Fatal:', e.message);
    return new Response(JSON.stringify({error:e.message}), {status:500});
  }
}
