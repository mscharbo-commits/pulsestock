// serverless runtime — full network access for CoinGecko/Binance

const FHK  = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const SUPABASE_URL = 'https://ttcprqkoibiztibhpsrp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0Y3BycWtvaWJpenRpYmhwc3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNTk5NjcsImV4cCI6MjA5NTkzNTk2N30.kO-a0NYLQ0rrAV1V7Aj4O8Mwm7KFq2NPfIQl2uY5sDY';

async function fh(path) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1${path}&token=${FHK}`);
    return r.ok ? r.json() : null;
  } catch(e) { return null; }
}

function bestPrice(q) {
  // For yields/indices (TNX ~4.7, VIX ~15-30) use c directly — no equity sanity check
  if (q && q.c && q.c > 0) return q.c;
  return q?.pc || null;
}
function _bestPrice_orig(q) {
  // Use current price if market open, prev close otherwise
  return (q && q.c && q.c > 0) ? q.c : (q && q.pc ? q.pc : null);
}
function bestChange(q) {
  return (q && q.c && q.c > 0 && q.pc) ? ((q.c - q.pc) / q.pc * 100).toFixed(2) : '0.00';
}

async function getLiveContext() {
  const sectors = ['SPY','QQQ','XLK','XLF','XLV','XLE','XLI','XLP','XLY','GLD','TLT','^VIX','^TNX','USO','SLV'];
  const news = ['AAPL','NVDA','MSFT','TSLA','AMZN','GOOGL','META','JPM'];
  const CRYPTO_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin';
  // Global indices + futures — Yahoo Finance symbols via Finnhub
  const OANOR_KEY = process.env.OANOR_API_KEY || '';
  const globalNames = {'USO':'WTI Oil ETF','UUP':'USD Index ETF','EWJ':'Japan ETF','EWG':'Germany ETF','EWU':'UK ETF','EFA':'Intl Dev ETF','EEM':'Emerging Mkts','QQQ':'Nasdaq ETF'};

  // Fetch all in parallel
  let sectorQuotes=[], marketNews=[], econCal=[], openPicks=[], cryptoPrices={}, globalData=[], forexRates=null, spotCommodities=[null,null,null];
  try {
  [sectorQuotes, marketNews, econCal, openPicks, cryptoPrices, globalData, forexRates, spotCommodities] = await Promise.all([
    Promise.all(sectors.map(s => fh(`/quote?symbol=${s}`).then(q => q ? {s, c:q.c, pc:q.pc, dp:q.dp, d:q.d} : null))),
    fh('/news?category=general&minId=0'),
    fh(`/calendar/economic?from=${new Date().toISOString().split('T')[0]}&to=${new Date(Date.now()+3*86400000).toISOString().split('T')[0]}`),
    fetch(`${SUPABASE_URL}/rest/v1/study_picks?status=eq.open&order=picked_at.desc&limit=6&select=ticker,strategy_id,thesis,entry_price,confidence`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    }).then(r => r.json()).catch(() => []),
    // Use CoinGecko via multiple fallback attempts
    (async () => {
      const urls = [
        `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd&include_24hr_change=true&x_cg_demo_api_key=CG-pwDvU5d2bQqDKVha9KGCkaCf`,
        `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd&include_24hr_change=true`
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const data = await r.json();
            if (data && data.bitcoin) return data;
          }
        } catch(e) {}
      }
      return {};
    })(),
    // Live forex rates
    fetch('https://api.exchangerate-api.com/v4/latest/USD')
      .then(r => r.ok ? r.json() : null).catch(() => null),
    // Live spot commodities via Eulerpool
    Promise.all([
      fetch('https://api.eulerpool.com/v1/commodities/XAUUSD/quote', {
        headers: { 'Authorization': `Bearer ${process.env.EULERPOOL_API_KEY}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('https://api.eulerpool.com/v1/commodities/WTICOUSD/quote', {
        headers: { 'Authorization': `Bearer ${process.env.EULERPOOL_API_KEY}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('https://api.eulerpool.com/v1/commodities/XAGUSD/quote', {
        headers: { 'Authorization': `Bearer ${process.env.EULERPOOL_API_KEY}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ])
  ]);
  } catch(fetchErr) { console.error('getLiveContext fetch error:', fetchErr.message); }

  const sq = sectorQuotes.filter(Boolean);
  const spy = sq.find(x => x.s === 'SPY');
  const vix = sq.find(x => x.s === '^VIX');
  const tnx = sq.find(x => x.s === '^TNX');

  const sectorLines = sq
    .filter(x => !['SPY','QQQ','^VIX','^TNX','GLD','TLT'].includes(x.s))
    .sort((a,b) => (b.dp||0) - (a.dp||0))
    .map(x => `${x.s}: $${x.c?.toFixed(2)||x.pc?.toFixed(2)||'N/A'} (${x.dp > 0 ? '+' : ''}${x.dp?.toFixed(2)||'0'}%)`)
    .join(' | ');

  const topNews = (Array.isArray(marketNews) ? marketNews : [])
    .slice(0, 6).map(n => `- ${n.headline}`).join('\n');

  const econEvents = (econCal?.economicCalendar || [])
    .filter(e => e.impact === 'High')
    .slice(0, 3)
    .map(e => `${e.event} (${new Date(e.time).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})})`)
    .join(', ') || 'None this week';

  const picksLines = (Array.isArray(openPicks) ? openPicks : [])
    .map(p => `${p.ticker} (${p.strategy_id}, conf:${p.confidence}%) — ${(p.thesis||'').slice(0,80)}`)
    .join('\n') || 'No open picks yet';

  const now = new Date().toLocaleString('en-US', {timeZone:'America/New_York', weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'});

  // Build crypto lines from CoinGecko
  const cryptoNameMap = {'bitcoin':'BTC','ethereum':'ETH','solana':'SOL','binancecoin':'BNB','ripple':'XRP','dogecoin':'DOGE'};
  const cryptoLines = Object.entries(cryptoNameMap).map(([id, sym]) => {
    const p = cryptoPrices[id];
    if (!p) return null;
    const chg = p.usd_24h_change?.toFixed(2) || '0.00';
    return `${sym}: $${p.usd?.toLocaleString()} (${Number(chg) > 0 ? '+' : ''}${chg}% 24h)`;
  }).filter(Boolean).join(' | ');

  return `LIVE MARKET DATA — ${now} ET

US EQUITIES (most recent session):
SPY: $${spy?.c?.toFixed(2)||spy?.pc?.toFixed(2)||'N/A'} (${spy?.dp > 0 ? '+' : ''}${spy?.dp?.toFixed(2)||'0'}% last session) | QQQ: $${sq.find(x=>x.s==='QQQ')?.c?.toFixed(2)||sq.find(x=>x.s==='QQQ')?.pc?.toFixed(2)||'N/A'} (${sq.find(x=>x.s==='QQQ')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='QQQ')?.dp?.toFixed(2)||'0'}%)
VIX: ${vix?.c?.toFixed(1)||vix?.pc?.toFixed(1)||'N/A'} ${(vix?.c||0) > 25 ? '— HIGH FEAR' : (vix?.c||0) > 18 ? '— ELEVATED' : '— CALM'}
10yr Yield (TNX): ${tnx?.c?.toFixed(2)||tnx?.pc?.toFixed(2)||'N/A'}% (${tnx?.dp > 0 ? '+' : ''}${tnx?.dp?.toFixed(3)||'0'}% change) | TLT Bond ETF: ${sq.find(x=>x.s==='TLT')?.c?.toFixed(2)||'N/A'} (${sq.find(x=>x.s==='TLT')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='TLT')?.dp?.toFixed(2)||'0'}%)
Gold (GLD): $${(sq.find(x=>x.s==='GLD')?.c||sq.find(x=>x.s==='GLD')?.pc||0).toFixed(2)} (${sq.find(x=>x.s==='GLD')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='GLD')?.dp?.toFixed(2)||'0'}%) | Oil (USO): $${(sq.find(x=>x.s==='USO')?.c||sq.find(x=>x.s==='USO')?.pc||0).toFixed(2)} (${sq.find(x=>x.s==='USO')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='USO')?.dp?.toFixed(2)||'0'}%) | Silver (SLV): $${(sq.find(x=>x.s==='SLV')?.c||sq.find(x=>x.s==='SLV')?.pc||0).toFixed(2)} (${sq.find(x=>x.s==='SLV')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='SLV')?.dp?.toFixed(2)||'0'}%) — USE THESE EXACT NUMBERS

CRYPTO (24h): ${cryptoLines || 'data unavailable'}

COMMODITIES (live spot):
Gold: $${spotCommodities?.[0]?.price?.toFixed(2)||'N/A'} (${spotCommodities?.[0]?.change_pct != null ? (spotCommodities[0].change_pct>0?'+':'')+spotCommodities[0].change_pct.toFixed(2)+'%' : 'see ETF GLD prev close $'+sq.find(x=>x.s==='GLD')?.pc?.toFixed(2)})
WTI Oil: $${spotCommodities?.[1]?.price?.toFixed(2)||'N/A'} (${spotCommodities?.[1]?.change_pct != null ? (spotCommodities[1].change_pct>0?'+':'')+spotCommodities[1].change_pct.toFixed(2)+'%' : 'see ETF USO prev close $'+sq.find(x=>x.s==='USO')?.pc?.toFixed(2)})
Silver: $${spotCommodities?.[2]?.price?.toFixed(2)||'N/A'} (${spotCommodities?.[2]?.change_pct != null ? (spotCommodities[2].change_pct>0?'+':'')+spotCommodities[2].change_pct.toFixed(2)+'%' : 'see ETF SLV prev close $'+sq.find(x=>x.s==='SLV')?.pc?.toFixed(2)})

CURRENCIES (live vs USD):
EUR/USD: ${forexRates?.rates?.EUR ? (1/forexRates.rates.EUR).toFixed(4) : 'N/A'} | USD/JPY: ${forexRates?.rates?.JPY?.toFixed(2)||'N/A'} | GBP/USD: ${forexRates?.rates?.GBP ? (1/forexRates.rates.GBP).toFixed(4) : 'N/A'} | USD/CNY: ${forexRates?.rates?.CNY?.toFixed(4)||'N/A'} | AUD/USD: ${forexRates?.rates?.AUD ? (1/forexRates.rates.AUD).toFixed(4) : 'N/A'} | USD/CAD: ${forexRates?.rates?.CAD?.toFixed(4)||'N/A'}

SECTORS TODAY: ${sectorLines}

TOP MARKET NEWS:
${topNews}

HIGH-IMPACT ECONOMIC EVENTS:
${econEvents}

PULSESTOCK OPEN PICKS (AI-selected):
${picksLines}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  try {
    const { messages, system } = req.body || {};
    if (!messages?.length) return res.status(400).json({error:'No messages'});

    // Get live market context
    const liveContext = await getLiveContext();

    const fullSystem = (system || '') + `

${liveContext}

INSTRUCTIONS:
- You HAVE live crypto prices above — ALWAYS use them when crypto is mentioned
- You HAVE global markets data above — futures, foreign indices, oil, DXY — ALWAYS use them for pre-market and opening questions
- Never say you don't have global or crypto data — it is all above
- When asked "what does the open look like" or "pre-market" questions — ALWAYS give a full snapshot: (1) S&P/Nasdaq direction from SPY/QQQ vs prev close, (2) global overnight from EWJ/EWG/EWU, (3) commodities USO/GLD, (4) dollar UUP/FXE/FXY, (5) VIX fear gauge, (6) geopolitical context from headlines — never just say "market is pre-open" without this data
- When asked WEEKLY OUTLOOK questions ("what's shaping the market this week", "weekly outlook", "what's moving markets this week") — you MUST cover ALL 6 of these sections with specific data and numbers from the context above:
  1. BOND MARKET & YIELDS — TNX (10-year yield), TLT direction, what rising/falling yields mean for equities right now, spread context. This is mandatory — the bond market drives everything else.
  2. MACRO THEME OF THE WEEK — dominant driver (geopolitical, Fed, earnings, data) with specific headlines and what it means for market direction
  3. SECTOR ROTATION — which sectors are leading/lagging with actual ETF percentages, what the rotation signals about investor sentiment
  4. COMMODITIES & DOLLAR — oil (USO), gold (GLD), DXY direction and what they signal about risk appetite and inflation expectations
  5. KEY CATALYSTS TO WATCH — specific events, data releases, geopolitical tripwires for the week ahead with dates if known
  6. TECHNICAL PICTURE — this is MANDATORY for traders: SPY and QQQ position relative to key moving averages (50-day, 200-day), RSI reading and what it signals (overbought >70, oversold <30, neutral), MACD momentum direction, VIX level and trend, key support and resistance levels for SPY/QQQ, whether the market is in an uptrend/downtrend/consolidation, and any chart patterns forming. Use VIX from the data above. Be specific — "SPY testing 50-day MA support" not vague generalities.
  7. TRADING POSTURE — what conviction level the setup supports based on the technical and macro picture combined, what PulseStock tools to use (Morning Picks, Death Spiral Tracker, AI Analysis)
- Use the live data above to give specific, current answers with real numbers
- When asked what moved the market, reference today's actual sector moves and news headlines above
- When asked about a specific stock or ticker, ALWAYS include: current price vs 52-week range, momentum direction, whether it's overbought/oversold, key support and resistance levels
- When asked for picks, reference PulseStock's open picks above and add your own analysis
- Give direct, confident answers with real prices and percentages — not generic advice
- NEVER say you don't have data, closing prices, or real-time data — all the data you need is in the LIVE MARKET DATA section above. Use it confidently with specific numbers.
- For weekly outlook: write all 7 sections but keep each section to 2-3 sentences max. No long paragraphs. Dense, information-rich, trader-focused. Use this format: bold section label on same line as content — "**BONDS:** TNX at 4.82%, TLT -1.1% — yields rising means growth stocks under pressure..." Keep it tight.
- For daily questions keep to 3-5 short paragraphs with technical context woven in.
- For individual stock questions always include technical analysis in the same response, not as a separate section.
- No excessive line breaks. No padding. Every sentence must contain a data point or actionable insight.
- Always tie back to PulseStock tools when relevant`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: fullSystem,
        messages: messages.slice(-4) // last 4 messages only — prevents stale history bleeding
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({error:err});
    }

    const data = await resp.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
