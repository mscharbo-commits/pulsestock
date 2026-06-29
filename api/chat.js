export const config = { runtime: 'edge' };

const FINNHUB = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getLiveContext(ticker) {
  const ctx = {};
  try {
    const [quoteRes, newsRes, profileRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${daysAgo(3)}&to=${today()}&token=${FINNHUB}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`)
    ]);
    const quote = quoteRes.ok ? await quoteRes.json() : {};
    const news = newsRes.ok ? await newsRes.json() : [];
    const profile = profileRes.ok ? await profileRes.json() : {};

    if (quote.c) {
      ctx.price = quote.c.toFixed(2);
      ctx.change = (quote.d || 0).toFixed(2);
      ctx.changePct = (quote.dp || 0).toFixed(2);
      ctx.high = (quote.h || 0).toFixed(2);
      ctx.low = (quote.l || 0).toFixed(2);
      ctx.prevClose = (quote.pc || 0).toFixed(2);
    }
    if (profile.name) {
      ctx.name = profile.name;
      ctx.industry = profile.finnhubIndustry;
      ctx.marketCap = profile.marketCapitalization ? `$${(profile.marketCapitalization/1000).toFixed(1)}B` : '';
    }
    if (news && news.length) {
      ctx.headlines = news.slice(0, 8).map(n => `- ${n.headline} (${new Date(n.datetime*1000).toLocaleDateString()})`).join('\n');
    }
  } catch(e) {}
  return ctx;
}

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { return new Date(Date.now() - n*86400000).toISOString().split('T')[0]; }

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { ticker, question } = await req.json();
    if (!ticker || !question) return new Response(JSON.stringify({ error: 'Missing ticker or question' }), { status: 400, headers: cors });

    // Fetch live context in parallel with no timeout blocking
    const ctx = await getLiveContext(ticker);

    // Build rich system prompt with real data
    let systemPrompt = `You are an expert financial analyst for PulseStock, a professional stock analysis platform.
The user is asking about ${ctx.name || ticker} (${ticker}).
Today's date: ${today()}.`;

    if (ctx.price) {
      systemPrompt += `\n\nLIVE MARKET DATA:
- Current Price: $${ctx.price}
- Change Today: ${ctx.change >= 0 ? '+' : ''}${ctx.change} (${ctx.changePct >= 0 ? '+' : ''}${ctx.changePct}%)
- Today's Range: $${ctx.low} - $${ctx.high}
- Previous Close: $${ctx.prevClose}`;
      if (ctx.marketCap) systemPrompt += `\n- Market Cap: ${ctx.marketCap}`;
      if (ctx.industry) systemPrompt += `\n- Industry: ${ctx.industry}`;
    }

    if (ctx.headlines) {
      systemPrompt += `\n\nRECENT NEWS HEADLINES (last 3 days):\n${ctx.headlines}`;
    }

    systemPrompt += `\n\nUsing the live data and news above, give a specific, analytical answer. Reference actual prices and headlines where relevant. Be concise (3-4 paragraphs max). Not financial advice.`;

    // Add web search instruction to system prompt
    systemPrompt += `\n\nIMPORTANT: You have web_search capability. For ANY question about recent news, leadership changes, earnings, FDA decisions, or current events — search the web FIRST before answering. Never rely only on the headlines above for current events.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [
          { role: 'user', content: systemPrompt + '\n\nQuestion: ' + question }
        ],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: 'Claude error: ' + resp.status + ' ' + err.slice(0,100) }), { status: 500, headers: cors });
    }

    const data = await resp.json();
    // Extract all text blocks (web search adds multiple content blocks)
    const text = (data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n') || data?.content?.[0]?.text || '';
    return new Response(JSON.stringify({ text }), { headers: cors });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
