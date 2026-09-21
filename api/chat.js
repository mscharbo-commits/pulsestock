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
  // Use current price if market open, prev close otherwise
  return (q && q.c && q.c > 0) ? q.c : (q && q.pc ? q.pc : null);
}
function bestChange(q) {
  return (q && q.c && q.c > 0 && q.pc) ? ((q.c - q.pc) / q.pc * 100).toFixed(2) : '0.00';
}

async function getLiveContext() {
  const sectors = ['SPY','QQQ','XLK','XLF','XLV','XLE','XLI','XLP','XLY','GLD','TLT','^VIX','^TNX'];
  const news = ['AAPL','NVDA','MSFT','TSLA','AMZN','GOOGL','META','JPM'];
  const CRYPTO_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin';
  // Global indices + futures — Yahoo Finance symbols via Finnhub
  // Global proxy ETFs via Finnhub (free tier supports these)
  const globalNames = {'USO':'WTI Oil ETF','UUP':'USD Index ETF','EWJ':'Japan ETF','EWG':'Germany ETF','EWU':'UK ETF','EFA':'Intl Dev ETF','EEM':'Emerging Mkts','QQQ':'Nasdaq ETF'};

  // Fetch all in parallel
  const [sectorQuotes, marketNews, econCal, openPicks, cryptoPrices, globalQuotes] = await Promise.all([
    Promise.all(sectors.map(s => fh(`/quote?symbol=${s}`).then(q => q ? {s, c:q.c, dp:q.dp, d:q.d} : null))),
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
    // Global proxies via Finnhub ETFs (free tier)
    // USO=WTI oil, UUP=DXY, EWJ=Nikkei proxy, EWG=DAX proxy, EWU=FTSE proxy, EEM=EM
    Promise.all(['USO','UUP','EWJ','EWG','EWU','EFA','EEM','QQQ'].map(s =>
      fh(`/quote?symbol=${s}`)
        .then(q => q ? ({ s, q }) : null)
        .catch(() => null)
    ))
  ]);

  const sq = sectorQuotes.filter(Boolean);
  const spy = sq.find(x => x.s === 'SPY');
  const vix = sq.find(x => x.s === '^VIX');
  const tnx = sq.find(x => x.s === '^TNX');

  const sectorLines = sq
    .filter(x => !['SPY','QQQ','^VIX','^TNX','GLD','TLT'].includes(x.s))
    .sort((a,b) => (b.dp||0) - (a.dp||0))
    .map(x => `${x.s}: ${x.dp > 0 ? '+' : ''}${x.dp?.toFixed(1)}%`)
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

MARKET: SPY $${spy?.c?.toFixed(2)||'N/A'} (${spy?.dp > 0 ? '+' : ''}${spy?.dp?.toFixed(2)||'0'}% today)
VIX: ${vix?.c?.toFixed(1)||'N/A'} ${(vix?.c||0) > 25 ? '— HIGH FEAR' : (vix?.c||0) > 18 ? '— ELEVATED' : '— CALM'}
10yr Yield: ${tnx?.c?.toFixed(2)||'N/A'}%
GLD: ${sq.find(x=>x.s==='GLD')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='GLD')?.dp?.toFixed(1)||'0'}% | TLT: ${sq.find(x=>x.s==='TLT')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='TLT')?.dp?.toFixed(1)||'0'}%

CRYPTO (24h): ${cryptoLines || 'data unavailable'}

GLOBAL MARKET PROXIES (ETF-based):
${(globalQuotes||[]).filter(Boolean).map(g => {
  if (!g.q?.c) return null;
  const price = g.q.c || g.q.pc;
  const chg = g.q.dp || 0;
  const name = globalNames[g.s] || g.s;
  return `${name} (${g.s}): $${price?.toFixed(2)} (${chg > 0 ? '+' : ''}${chg?.toFixed(2)}% today)`;
}).filter(Boolean).join(' | ') || 'unavailable - market may be closed'}

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
- When asked "what does the open look like" or "pre-market" questions — use the GLOBAL MARKET PROXIES above: USO for oil direction, UUP for dollar strength, EWJ/EWG/EWU for Asia/Europe overnight, EEM for emerging markets; note these are ETF proxies not live futures
- Use the live data above to give specific, current answers with real numbers
- When asked what moved the market, reference today's actual sector moves and news headlines above
- When asked for picks, reference PulseStock's open picks above and add your own analysis
- Give direct, confident answers with real prices and percentages — not generic advice
- Keep responses concise: 3-5 paragraphs max, no excessive headers
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
        max_tokens: 600,
        system: fullSystem,
        messages
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
