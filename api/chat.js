export const config = { runtime: 'nodejs' };

const FINNHUB = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getLiveContext(ticker) {
  const ctx = {};
  try {
    const today = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 3*86400000).toISOString().split('T')[0];
    const [quoteRes, newsRes, profileRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${today}&token=${FINNHUB}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`)
    ]);
    const quote = quoteRes.ok ? await quoteRes.json() : {};
    const news = newsRes.ok ? await newsRes.json() : [];
    const profile = profileRes.ok ? await profileRes.json() : {};
    if (quote.c) {
      ctx.price = quote.c.toFixed(2);
      ctx.change = (quote.d||0).toFixed(2);
      ctx.changePct = (quote.dp||0).toFixed(2);
      ctx.high = (quote.h||0).toFixed(2);
      ctx.low = (quote.l||0).toFixed(2);
      ctx.prevClose = (quote.pc||0).toFixed(2);
    }
    if (profile.name) {
      ctx.name = profile.name;
      ctx.industry = profile.finnhubIndustry;
      ctx.marketCap = profile.marketCapitalization ? `$${(profile.marketCapitalization/1000).toFixed(1)}B` : '';
    }
    if (news && news.length) {
      ctx.headlines = news.slice(0,8).map(n => `- ${n.headline}`).join('\n');
    }
  } catch(e) {}
  return ctx;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { ticker, question } = body;
    if (!ticker || !question) return res.status(400).json({ error: 'Missing ticker or question' });

    const ctx = await getLiveContext(ticker);
    const today = new Date().toISOString().split('T')[0];

    let systemPrompt = `You are PulseAI, an expert financial analyst for PulseStock.
The user is asking about ${ctx.name || ticker} (${ticker}). Today: ${today}.
You have web_search capability — use it for ANY question about recent events, news, leadership changes, earnings, or anything time-sensitive. Always search before answering current events questions.`;

    if (ctx.price) {
      systemPrompt += `\n\nLIVE DATA: Price $${ctx.price} (${ctx.changePct >= 0 ? '+' : ''}${ctx.changePct}% today), Range $${ctx.low}-$${ctx.high}`;
      if (ctx.marketCap) systemPrompt += `, Market Cap ${ctx.marketCap}`;
    }
    if (ctx.headlines) {
      systemPrompt += `\n\nRECENT HEADLINES:\n${ctx.headlines}`;
    }
    systemPrompt += `\n\nBe specific and analytical. Reference real data. 3-4 paragraphs max. Not financial advice.`;

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: systemPrompt + '\n\nQuestion: ' + question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!apiResp.ok) {
      const err = await apiResp.text();
      return res.status(500).json({ error: 'Claude error: ' + apiResp.status + ' — ' + err.slice(0,150) });
    }

    const data = await apiResp.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || 'No response generated.';

    return res.status(200).json({ text });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
