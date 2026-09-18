export const config = { runtime: 'edge' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
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
  const CRYPTO_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,avalanche-2,dogecoin';

  // Fetch all in parallel
  const [sectorQuotes, marketNews, econCal, openPicks, cryptoPrices] = await Promise.all([
    Promise.all(sectors.map(s => fh(`/quote?symbol=${s}`).then(q => q ? {s, c:q.c, dp:q.dp, d:q.d} : null))),
    fh('/news?category=general&minId=0'),
    fh(`/calendar/economic?from=${new Date().toISOString().split('T')[0]}&to=${new Date(Date.now()+3*86400000).toISOString().split('T')[0]}`),
    fetch(`${SUPABASE_URL}/rest/v1/study_picks?status=eq.open&order=picked_at.desc&limit=6&select=ticker,strategy_id,thesis,entry_price,confidence`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    }).then(r => r.json()).catch(() => []),
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd&include_24hr_change=true&x_cg_demo_api_key=CG-pwDvU5d2bQqDKVha9KGCkaCf`)
      .then(r => r.ok ? r.json() : {}).catch(() => ({}))
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

  // Build crypto lines
  const cryptoMap = {
    'bitcoin':'BTC','ethereum':'ETH','solana':'SOL',
    'binancecoin':'BNB','ripple':'XRP','cardano':'ADA',
    'avalanche-2':'AVAX','dogecoin':'DOGE'
  };
  const cryptoLines = Object.entries(cryptoMap).map(([id, sym]) => {
    const p = cryptoPrices[id];
    if (!p) return null;
    const chg = p.usd_24h_change?.toFixed(2) || '0.00';
    return `${sym}: $${p.usd?.toLocaleString()} (${chg > 0 ? '+' : ''}${chg}% 24h)`;
  }).filter(Boolean).join(' | ');

  return `LIVE MARKET DATA — ${now} ET

MARKET: SPY $${spy?.c?.toFixed(2)||'N/A'} (${spy?.dp > 0 ? '+' : ''}${spy?.dp?.toFixed(2)||'0'}% today)
VIX: ${vix?.c?.toFixed(1)||'N/A'} ${(vix?.c||0) > 25 ? '— HIGH FEAR' : (vix?.c||0) > 18 ? '— ELEVATED' : '— CALM'}
10yr Yield: ${tnx?.c?.toFixed(2)||'N/A'}%
GLD: ${sq.find(x=>x.s==='GLD')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='GLD')?.dp?.toFixed(1)||'0'}% | TLT: ${sq.find(x=>x.s==='TLT')?.dp > 0 ? '+' : ''}${sq.find(x=>x.s==='TLT')?.dp?.toFixed(1)||'0'}%

CRYPTO (24h): ${cryptoLines || 'data unavailable'}

SECTORS TODAY: ${sectorLines}

TOP MARKET NEWS:
${topNews}

HIGH-IMPACT ECONOMIC EVENTS:
${econEvents}

PULSESTOCK OPEN PICKS (AI-selected):
${picksLines}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'POST only'}), {status:405,headers:CORS});

  try {
    const { messages, system } = await req.json();
    if (!messages?.length) return new Response(JSON.stringify({error:'No messages'}), {status:400,headers:CORS});

    // Get live market context
    const liveContext = await getLiveContext();

    const fullSystem = (system || '') + `

${liveContext}

INSTRUCTIONS:
- Use the live data above to give specific, current answers
- When asked what moved the market, reference today's actual sector moves and news headlines above
- When asked for picks, reference PulseStock's open picks above and add your own analysis
- Give direct, confident answers — not generic advice
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
      return new Response(JSON.stringify({error:err}), {status:resp.status,headers:CORS});
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers:CORS});
  }
}
