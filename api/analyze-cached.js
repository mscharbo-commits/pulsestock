export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const FINNHUB_KEY = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON_KEY = process.env.POLYGON_API_KEY || '';

// Map Finnhub industry to sector ETF
const SECTOR_ETF = {
  'Technology': 'XLK', 'Semiconductors': 'XLK', 'Software': 'XLK',
  'Financial Services': 'XLF', 'Banks': 'XLF', 'Insurance': 'XLF',
  'Energy': 'XLE', 'Oil & Gas': 'XLE',
  'Healthcare': 'XLV', 'Biotechnology': 'XLV', 'Pharmaceuticals': 'XLV',
  'Industrials': 'XLI', 'Aerospace & Defense': 'XLI',
  'Consumer Cyclical': 'XLY', 'Retail': 'XLY', 'Automotive': 'XLY',
  'Consumer Defensive': 'XLP', 'Food & Beverage': 'XLP',
  'Communication Services': 'XLC', 'Media': 'XLC',
  'Real Estate': 'XLRE',
  'Utilities': 'XLU',
  'Basic Materials': 'XLB', 'Metals & Mining': 'XLB',
};

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

    let contextData = '';

    if (ticker) {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];

      // Step 1: fetch profile first to get sector
      const profile = await safeFetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`);
      const sector = profile?.finnhubIndustry || '';
      const sectorEtf = SECTOR_ETF[sector] || null;

      // Step 2: fetch everything else in parallel
      const fetchList = [
        safeFetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`),
        // Broad market
        safeFetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/quote?symbol=QQQ&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB_KEY}`),
        // Sector ETF
        sectorEtf ? safeFetch(`https://finnhub.io/api/v1/quote?symbol=${sectorEtf}&token=${FINNHUB_KEY}`) : Promise.resolve(null),
        sectorEtf ? safeFetch(`https://finnhub.io/api/v1/company-news?symbol=${sectorEtf}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`) : Promise.resolve(null),
        // Polygon for volume/VWAP
        POLYGON_KEY ? safeFetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY}`) : Promise.resolve(null),
      ];

      const [quote, metrics, news, spy, qqq, vix, sectorQ, sectorNews, polySnap] = await Promise.all(fetchList);

      const parts = [];

      // Stock data
      if (quote?.c) {
        parts.push(`=== ${ticker} CURRENT DATA ===`);
        parts.push(`Price: $${quote.c.toFixed(2)} | Change: ${quote.dp >= 0 ? '+' : ''}${quote.dp?.toFixed(2)}% ($${quote.d?.toFixed(2)}) | High: $${quote.h} | Low: $${quote.l} | Open: $${quote.o} | Prev Close: $${quote.pc}`);
      }
      if (profile?.name) {
        parts.push(`Company: ${profile.name} | Sector: ${sector} | Industry: ${profile.finnhubIndustry} | Market Cap: $${profile.marketCapitalization ? (profile.marketCapitalization/1000).toFixed(1)+'B' : 'N/A'} | Exchange: ${profile.exchange}`);
      }
      if (polySnap?.ticker?.day) {
        const d = polySnap.ticker.day;
        parts.push(`Volume: ${d.v?.toLocaleString()} | VWAP: $${d.vw?.toFixed(2)}`);
      }
      if (metrics?.metric) {
        const m = metrics.metric;
        const metricParts = [
          m.peBasicExclExtraTTM ? `P/E TTM: ${m.peBasicExclExtraTTM.toFixed(1)}x` : '',
          m.epsBasicExclExtraAnnual ? `EPS: $${m.epsBasicExclExtraAnnual.toFixed(2)}` : '',
          m.revenueGrowthTTMYoy ? `Rev Growth: ${(m.revenueGrowthTTMYoy*100).toFixed(1)}%` : '',
          m.netProfitMarginAnnual ? `Net Margin: ${m.netProfitMarginAnnual.toFixed(1)}%` : '',
          m['52WeekHigh'] ? `52W Range: $${m['52WeekLow']} - $${m['52WeekHigh']}` : '',
          m.beta ? `Beta: ${m.beta.toFixed(2)}` : '',
          m.rsi14 ? `RSI: ${m.rsi14.toFixed(0)}` : '',
        ].filter(Boolean).join(' | ');
        if (metricParts) parts.push(`Fundamentals: ${metricParts}`);
      }

      // Stock news
      if (news?.length) {
        parts.push(`\n=== ${ticker} RECENT NEWS (last 7 days) ===`);
        news.slice(0, 5).forEach(n => {
          parts.push(`• ${n.headline} (${new Date(n.datetime*1000).toLocaleDateString()})`);
        });
      }

      // Sector performance
      if (sectorEtf && sectorQ?.c) {
        parts.push(`\n=== SECTOR PERFORMANCE (${sector}) ===`);
        parts.push(`${sectorEtf} ETF: $${sectorQ.c.toFixed(2)} | ${sectorQ.dp >= 0 ? '+' : ''}${sectorQ.dp?.toFixed(2)}% today`);
        if (sectorNews?.length) {
          parts.push(`Sector News:`);
          sectorNews.slice(0, 3).forEach(n => {
            parts.push(`• ${n.headline}`);
          });
        }
      }

      // Broad market
      parts.push(`\n=== BROAD MARKET CONTEXT ===`);
      if (spy?.c) parts.push(`SPY (S&P 500): $${spy.c.toFixed(2)} | ${spy.dp >= 0 ? '+' : ''}${spy.dp?.toFixed(2)}% — ${spy.dp > 0.5 ? 'Risk-On' : spy.dp < -0.5 ? 'Risk-Off' : 'Neutral'}`);
      if (qqq?.c) parts.push(`QQQ (Nasdaq): $${qqq.c.toFixed(2)} | ${qqq.dp >= 0 ? '+' : ''}${qqq.dp?.toFixed(2)}%`);
      if (vix?.c) parts.push(`VIX: ${vix.c.toFixed(1)} — ${vix.c > 25 ? 'High Fear (>25)' : vix.c > 18 ? 'Elevated Volatility' : 'Low Fear / Complacent'}`);

      contextData = parts.join('\n');
    }

    const system = contextData
      ? `You are a senior institutional stock analyst delivering a deep-dive analysis. Today\'s live market data:\n\n${contextData}\n\nUsing ONLY this data, write a comprehensive analysis in exactly 5 sections with headers:\n\n1. **Market Context** — How is the broad market and sector performing today? Is this a headwind or tailwind for ${ticker}?\n2. **Technical Picture** — Price action, momentum, key levels based on today\'s data.\n3. **Fundamental Snapshot** — Key metrics, valuation, growth profile.\n4. **News & Catalysts** — What news is driving the stock? Any sector-level catalysts?\n5. **🎯 ENTRY / EXIT STRATEGY** — You MUST include all three of the following subsections with this exact format:\n\n🟢 ENTRY ZONE\n$[price range] — reason: [specific reason anchored to current price and technicals]\n\n🔴 STOP LOSS\n$[price] — reason: [specific level that invalidates the thesis with % downside]\n\n📍 TARGET 1\n$[price] — reason: [specific resistance or valuation level with % upside and timeframe]\n\nAll prices must be anchored to the actual current price in the data. No vague ranges. No disclaimers.\n\nBe specific with actual numbers from the data. Write for a sophisticated institutional investor.`
      : 'You are an institutional stock analyst. Provide a deep-dive analysis in 5 sections: Market Context, Technical Picture, Fundamentals, News & Catalysts, Outlook & Strategy.';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
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
