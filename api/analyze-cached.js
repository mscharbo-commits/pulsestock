export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
const POLYGON_KEY = process.env.POLYGON_API_KEY || '';

async function safeFetch(url, timeout = 4000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const messages = body.messages || [];
    const ticker = body.ticker || '';
    if (!messages.length) return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (!process.env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Pre-fetch market data in parallel so Claude doesn't need web search
    let contextData = '';
    if (ticker) {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];

      const [quote, profile, news, metrics] = await Promise.all([
        safeFetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`),
      ]);

      // Polygon snapshot for additional data
      let polySnap = null;
      if (POLYGON_KEY) {
        polySnap = await safeFetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY}`);
      }

      const parts = [];
      if (quote?.c) parts.push(`Current price: $${quote.c.toFixed(2)}, Change: ${quote.dp?.toFixed(2)}%, High: $${quote.h}, Low: $${quote.l}, Open: $${quote.o}, Prev Close: $${quote.pc}`);
      if (profile?.name) parts.push(`Company: ${profile.name}, Sector: ${profile.finnhubIndustry}, Market Cap: $${profile.marketCapitalization?.toFixed(0)}M, Exchange: ${profile.exchange}`);
      if (metrics?.metric) {
        const m = metrics.metric;
        const metricStr = [
          m['peBasicExclExtraTTM'] ? `P/E TTM: ${m['peBasicExclExtraTTM'].toFixed(1)}` : '',
          m['epsBasicExclExtraAnnual'] ? `EPS: $${m['epsBasicExclExtraAnnual'].toFixed(2)}` : '',
          m['revenueGrowthTTMYoy'] ? `Revenue Growth YoY: ${(m['revenueGrowthTTMYoy']*100).toFixed(1)}%` : '',
          m['netProfitMarginAnnual'] ? `Net Margin: ${m['netProfitMarginAnnual'].toFixed(1)}%` : '',
          m['52WeekHigh'] ? `52W High: $${m['52WeekHigh']}, 52W Low: $${m['52WeekLow']}` : '',
          m['beta'] ? `Beta: ${m['beta'].toFixed(2)}` : '',
        ].filter(Boolean).join(', ');
        if (metricStr) parts.push(`Key Metrics: ${metricStr}`);
      }
      if (news?.length) {
        const topNews = news.slice(0, 3).map(n => n.headline).join(' | ');
        parts.push(`Recent News: ${topNews}`);
      }
      if (polySnap?.ticker) {
        const pt = polySnap.ticker;
        if (pt.day) parts.push(`Today Volume: ${pt.day.v?.toLocaleString()}, VWAP: $${pt.day.vw?.toFixed(2)}`);
      }
      contextData = parts.join('\n');
    }

    // Build system prompt with pre-fetched data — no web search needed
    const system = contextData
      ? `You are an institutional stock analyst providing deep-dive analysis. Use this live market data:\n\n${contextData}\n\nProvide specific, data-driven analysis referencing these exact numbers. Be concise — 4-5 focused paragraphs covering: current technicals, fundamentals, recent news catalysts, risks, and outlook. No disclaimers.`
      : (body.system || 'You are an institutional stock analyst. Be concise and data-driven. Respond in 4 focused paragraphs.');

    // Stream directly — no web search tool needed since we pre-fetched data
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: true,
        system,
        messages
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err.slice(0,300) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(resp.body, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
