export const config = { runtime: 'edge' };

const GIST_TOKEN = process.env.GITHUB_TOKEN;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CRON_SECRET = process.env.CRON_SECRET;

// PulseStock curated universe — 30 stocks across sectors
const UNIVERSE = [
  // MEGA CAP TECH
  { sym:'AAPL', name:'Apple', sector:'Tech' },
  { sym:'MSFT', name:'Microsoft', sector:'Tech' },
  { sym:'NVDA', name:'Nvidia', sector:'Tech' },
  { sym:'GOOGL', name:'Alphabet', sector:'Tech' },
  { sym:'META', name:'Meta', sector:'Tech' },
  { sym:'AMZN', name:'Amazon', sector:'Tech' },
  // FINANCE
  { sym:'JPM', name:'JPMorgan', sector:'Finance' },
  { sym:'GS', name:'Goldman Sachs', sector:'Finance' },
  { sym:'BAC', name:'Bank of America', sector:'Finance' },
  { sym:'V', name:'Visa', sector:'Finance' },
  // HEALTHCARE
  { sym:'UNH', name:'UnitedHealth', sector:'Healthcare' },
  { sym:'LLY', name:'Eli Lilly', sector:'Healthcare' },
  { sym:'JNJ', name:'J&J', sector:'Healthcare' },
  { sym:'ABBV', name:'AbbVie', sector:'Healthcare' },
  // ENERGY
  { sym:'XOM', name:'ExxonMobil', sector:'Energy' },
  { sym:'CVX', name:'Chevron', sector:'Energy' },
  { sym:'OXY', name:'Occidental', sector:'Energy' },
  // CONSUMER
  { sym:'TSLA', name:'Tesla', sector:'Consumer' },
  { sym:'WMT', name:'Walmart', sector:'Consumer' },
  { sym:'HD', name:'Home Depot', sector:'Consumer' },
  { sym:'NKE', name:'Nike', sector:'Consumer' },
  { sym:'MCD', name:'McDonald\'s', sector:'Consumer' },
  // INDUSTRIALS
  { sym:'CAT', name:'Caterpillar', sector:'Industrial' },
  { sym:'BA', name:'Boeing', sector:'Industrial' },
  { sym:'GE', name:'GE Aerospace', sector:'Industrial' },
  // SEMIS
  { sym:'AMD', name:'AMD', sector:'Semi' },
  { sym:'TSM', name:'TSMC', sector:'Semi' },
  { sym:'INTC', name:'Intel', sector:'Semi' },
  // MACRO
  { sym:'SPY', name:'S&P 500 ETF', sector:'Index' },
  { sym:'QQQ', name:'Nasdaq ETF', sector:'Index' },
];

async function getQuote(sym) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return d.c > 0 ? { price: d.c, change: d.d, pct: d.dp, high: d.h, low: d.l, prevClose: d.pc } : null;
  } catch(e) { return null; }
}

async function getNews(sym) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 3*86400000).toISOString().split('T')[0];
    const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return (d||[]).slice(0,5).map(n => n.headline).join(' | ');
  } catch(e) { return ''; }
}

async function analyzePick(stock, quote, news) {
  const prompt = `You are PulseStock's senior market analyst. Analyze ${stock.sym} (${stock.name}) for today's trading session.

LIVE DATA:
- Price: $${quote.price.toFixed(2)} | Change: ${quote.pct > 0 ? '+' : ''}${quote.pct.toFixed(2)}%
- Today Range: $${quote.low.toFixed(2)} - $${quote.high.toFixed(2)}
- Prev Close: $${quote.prevClose.toFixed(2)}
- Sector: ${stock.sector}

RECENT HEADLINES: ${news || 'No recent news'}

Based on price action, momentum, and news sentiment, provide:
1. RATING: BUY, WATCH, or AVOID (one word only)
2. CONFIDENCE: percentage 0-100
3. REASON: one concise sentence (max 20 words) explaining the rating
4. PRICE_TARGET: realistic 30-day price target

Respond in this exact JSON format only, no other text:
{"rating":"BUY","confidence":72,"reason":"Strong momentum with positive earnings revision and sector tailwinds","target":195.00}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await resp.json();
  const text = data?.content?.[0]?.text || '';
  try {
    return JSON.parse(text.trim());
  } catch(e) {
    return { rating: 'WATCH', confidence: 50, reason: 'Analysis unavailable', target: quote.price };
  }
}

async function saveGist(picks, performance) {
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const cache = { date: today, generated: new Date().toISOString(), picks };

  await fetch(`https://api.github.com/gists/${PICKS_GIST}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'PulseStock' },
    body: JSON.stringify({
      files: {
        'picks_cache.json': { content: JSON.stringify(cache) },
        'picks_performance.json': { content: JSON.stringify(performance) }
      }
    })
  });
}

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });

  try {
    console.log('[cron-picks] Starting morning picks generation...');
    const picks = [];

    for (const stock of UNIVERSE) {
      const [quote, news] = await Promise.all([getQuote(stock.sym), getNews(stock.sym)]);
      if (!quote) { console.log(`[cron-picks] No quote for ${stock.sym}, skipping`); continue; }

      const analysis = await analyzePick(stock, quote, news);
      picks.push({
        sym: stock.sym, name: stock.name, sector: stock.sector,
        price: quote.price, change: quote.change, pct: quote.pct,
        rating: analysis.rating, confidence: analysis.confidence,
        reason: analysis.reason, target: analysis.target,
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now()
      });
    }

    // Load existing performance log
    let performance = { picks: [], summary: {} };
    try {
      const gr = await fetch(`https://api.github.com/gists/${PICKS_GIST}`,
        { headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'User-Agent': 'PulseStock' } });
      const gd = await gr.json();
      const raw = gd?.files?.['picks_performance.json']?.content;
      if (raw) performance = JSON.parse(raw);
    } catch(e) {}

    // Add today's picks to performance log for tracking
    const today = new Date().toISOString().split('T')[0];
    performance.picks = performance.picks.filter(p => p.date !== today); // remove today's if rerun
    performance.picks.push(...picks.map(p => ({ ...p, priceAtPick: p.price })));

    // Keep only last 90 days
    const cutoff = Date.now() - 90 * 86400000;
    performance.picks = performance.picks.filter(p => new Date(p.date).getTime() > cutoff);

    await saveGist(picks, performance);
    console.log(`[cron-picks] Done — ${picks.length} picks generated`);

    return new Response(JSON.stringify({ success: true, count: picks.length, picks }),
      { headers: { 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[cron-picks] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
