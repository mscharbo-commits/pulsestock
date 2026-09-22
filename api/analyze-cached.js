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

async function quiverFetch(path, key, timeout = 5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(`https://api.quiverquant.com/beta/${path}`, {
      signal: ctrl.signal,
      headers: { 'Authorization': `Token ${key}`, 'Accept': 'application/json' }
    });
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
    const forceRefresh = body.forceRefresh || false;
    const intelligence = body.intelligence || null;
    if (!messages.length) return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (!process.env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // ── SMART CACHE CHECK ──
    // Before fetching data or calling Claude, check if we have a valid cached analysis
    if (ticker && !forceRefresh) {
      try {
        const host = req.headers.get('host') || 'pulsestock-nu.vercel.app';
        const cacheResp = await fetch(`https://${host}/api/analysis-cache?ticker=${ticker}&action=check`, {
          signal: AbortSignal.timeout(4000)
        });
        if (cacheResp.ok) {
          const cacheData = await cacheResp.json();
          if (cacheData.hit && cacheData.analysis) {
            console.log(`[cache] HIT ${ticker} — ${cacheData.reason}`);

            // Fetch live quote for fresh entry/exit section — always current
            const liveQuote = await safeFetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
            const livePrice = liveQuote?.c || cacheData.priceAtGeneration || 0;
            const livePct   = liveQuote?.dp || 0;

            // Generate fresh Entry/Exit section using Haiku (cheap, fast)
            let entryExit = '';
            if (process.env.ANTHROPIC_API_KEY && livePrice > 0) {
              try {
                const eeResp = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31' },
                  body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 400,
                    messages: [{
                      role: 'user',
                      content: `Generate the Entry/Exit Strategy section for ${ticker} based on this context:

Current price: $${livePrice.toFixed(2)} (${livePct >= 0 ? '+' : ''}${livePct.toFixed(2)}% today)

Prior analysis context:
${cacheData.analysis.slice(0, 800)}

Write ONLY the entry/exit section in this exact format — nothing else:

🎯 ENTRY / EXIT STRATEGY

🟢 ENTRY ZONE
$[range] — reason: [specific reason using current price $${livePrice.toFixed(2)} and key levels]

🔴 STOP LOSS
$[price] — reason: [level that invalidates thesis, % downside from $${livePrice.toFixed(2)}]

📍 TARGET 1
$[price] — reason: [resistance level, % upside from $${livePrice.toFixed(2)}, timeframe]

🎯 TARGET 2
$[price] — reason: [aggressive target, % upside, catalyst required]

📐 POSITION SIZE
[%] — reason: [rationale]

⏱ TIME HORIZON
[timeframe] — reason: [specific catalysts to watch]`
                    }]
                  })
                });
                if (eeResp.ok) {
                  const eeData = await eeResp.json();
                  entryExit = '\n\n' + (eeData.content?.[0]?.text?.trim() || '');
                }
              } catch(e) { console.log('[cache] Entry/exit generation failed:', e.message); }
            }

            // Stream cached analysis + fresh entry/exit
            const fullAnalysis = cacheData.analysis + entryExit;
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "cache_hit", generated: cacheData.generated })}\n\n`));
                const chunks = fullAnalysis.match(/.{1,100}/g) || [];
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: chunk } })}\n\n`));
                }
                controller.enqueue(encoder.encode("data: {\"type\":\"message_stop\"}\n\n"));
                controller.close();
              }
            });
            return new Response(stream, {
              headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'X-Cache': 'HIT' }
            });
          } else {
            console.log(`[cache] MISS ${ticker} — ${cacheData.reason}`);
          }
        }
      } catch(e) {
        console.log(`[cache] Check failed for ${ticker}:`, e.message);
        // Continue to fresh analysis on cache check failure
      }
    }

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
        // Insider transactions (SEC Form 4)
        safeFetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`),
        // Analyst recommendations + price target
        safeFetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`),
        safeFetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_KEY}`),
        // Short interest
        safeFetch(`https://finnhub.io/api/v1/stock/short-interest?symbol=${ticker}&token=${FINNHUB_KEY}`),
        // Institutional ownership
        safeFetch(`https://finnhub.io/api/v1/institutional/ownership?symbol=${ticker}&token=${FINNHUB_KEY}`),
      ];

      const [quote, metrics, news, spy, qqq, vix, sectorQ, sectorNews, polySnap, insiderRaw, analystRec, analystTarget, shortInt, institutional, congressTrades, quiverShort, lobbying] = await Promise.all(fetchList);

      // Debug: log what data we got
      console.log('[analyze] data check:', {
        hasInsider: !!insiderRaw?.data?.length, insiderCount: insiderRaw?.data?.length || 0,
        hasAnalystRec: !!analystRec?.length,
        hasIntelligence: !!intelligence, intelligenceKeys: intelligence ? Object.keys(intelligence) : [],
      });

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

      // === INSIDER TRANSACTIONS ===
      const insiders = insiderRaw?.data?.filter(t => t.transactionType === 'P-Purchase' || t.transactionType === 'S-Sale').slice(0,5) || [];
      if (insiders.length) {
        const buys = insiders.filter(t => t.transactionType === 'P-Purchase').length;
        const sells = insiders.filter(t => t.transactionType === 'S-Sale').length;
        parts.push(`\n=== INSIDER ACTIVITY (last 90 days) ===`);
        parts.push(`${buys} insider purchases, ${sells} insider sales`);
        insiders.forEach(t => parts.push(`• ${t.name} (${t.officerTitle||'Insider'}): ${t.transactionType==='P-Purchase'?'BUY':'SELL'} ${t.share?.toLocaleString()||0} shares @ $${t.price?.toFixed(2)||0}`));
      }

      // === ANALYST CONSENSUS ===
      if (analystRec?.length) {
        const ar = analystRec[0];
        const total = (ar.strongBuy||0)+(ar.buy||0)+(ar.hold||0)+(ar.sell||0)+(ar.strongSell||0);
        const bullPct = total ? (((ar.strongBuy||0)+(ar.buy||0))/total*100).toFixed(0) : 0;
        parts.push(`\n=== ANALYST CONSENSUS (${ar.period}) ===`);
        parts.push(`${total} analysts — Strong Buy: ${ar.strongBuy||0}, Buy: ${ar.buy||0}, Hold: ${ar.hold||0}, Sell: ${ar.sell||0}, Strong Sell: ${ar.strongSell||0} | ${bullPct}% bullish`);
        if (analystTarget?.targetMean) parts.push(`Price Target: Mean $${analystTarget.targetMean?.toFixed(2)} | High $${analystTarget.targetHigh?.toFixed(2)} | Low $${analystTarget.targetLow?.toFixed(2)} | ${analystTarget.numberOfAnalysts||'N/A'} analysts`);
        else if (analystTarget?.targetMedian) parts.push(`Price Target: Median $${analystTarget.targetMedian?.toFixed(2)}`);
      }

      // === SHORT INTEREST (from FINRA via frontend) ===
      if (intelligence?.darkPool?.latest) {
        const dp = intelligence.darkPool.latest;
        parts.push(`\n=== SHORT SALE FLOW (FINRA) ===`);
        parts.push(`Short Sale Volume: ${dp.shortSalePct}% of total volume | Net flow: ${dp.netDollar >= 0 ? 'Net BUYING' : 'Net SELLING'} ($${Math.abs(dp.netDollar/1e9).toFixed(2)}B net)`);
        if (intelligence.darkPool.trend) parts.push(`5-Day Trend: ${intelligence.darkPool.trend}`);
      }
      if (intelligence?.borrowRate) {
        const br = intelligence.borrowRate;
        const brParts = [];
        if (br.shortPct) brParts.push(`Short Float: ${br.shortPct}%`);
        if (br.shortRatio) brParts.push(`Days to Cover: ${br.shortRatio}`);
        if (br.annualFee) brParts.push(`Borrow Rate: ${br.annualFee}% annually`);
        if (brParts.length) parts.push(`Short Interest: ${brParts.join(' | ')}`);
      }

      // === SHORT INTEREST (Finnhub fallback) ===
      if (shortInt?.shortInterest) {
        const si = Array.isArray(shortInt.shortInterest) ? shortInt.shortInterest[0] : shortInt.shortInterest;
        if (si) {
          parts.push(`\n=== SHORT INTEREST ===`);
          parts.push(`Short Interest: ${si.shortInterest?.toLocaleString()||'N/A'} shares | Days to Cover: ${si.daysToCover?.toFixed(1)||'N/A'} | Short % Float: ${si.shortPercent?.toFixed(1)||'N/A'}%`);
        }
      }

      // === INSTITUTIONAL OWNERSHIP ===
      if (institutional?.ownership?.length) {
        parts.push(`\n=== INSTITUTIONAL OWNERSHIP ===`);
        institutional.ownership.slice(0,3).forEach(i => parts.push(`• ${i.name}: ${i.share?.toLocaleString()||0} shares (${i.percentShares?.toFixed(2)||0}%)`));
      }
      if (intelligence?.congressional?.length) {
        parts.push(`\n=== CONGRESSIONAL TRADES ===`);
        intelligence.congressional.slice(0,3).forEach(t => parts.push(`• ${t.representative} (${t.party}): ${t.type} $${t.amount} on ${t.transactionDate}`));
      }
      // Quiver congressional trades
      if (Array.isArray(congressTrades) && congressTrades.length) {
        parts.push(`\n=== CONGRESSIONAL TRADES (Quiver) ===`);
        congressTrades.slice(0,5).forEach(t => parts.push(`• ${t.Representative} (${t.Party||'?'}): ${t.Transaction} $${t.Range} on ${t.TransactionDate} — ${t.Ticker}`));
      }
      // Quiver short interest
      if (Array.isArray(quiverShort) && quiverShort.length) {
        const si = quiverShort[0];
        parts.push(`\n=== SHORT INTEREST (Quiver) ===`);
        parts.push(`Short % of Float: ${si.ShortPercent?.toFixed(1)}% | Short Interest: ${si.ShortInterest?.toLocaleString()} shares | Date: ${si.Date}`);
        if (quiverShort.length > 1) {
          const prev = quiverShort[1];
          const chg = si.ShortPercent - prev.ShortPercent;
          parts.push(`Trend: ${chg > 0 ? '↑ Short interest INCREASING' : '↓ Short interest DECREASING'} (${chg > 0 ? '+' : ''}${chg.toFixed(1)}% vs prior period)`);
        }
      }
      // Quiver lobbying
      if (Array.isArray(lobbying) && lobbying.length) {
        const total = lobbying.reduce((s,l) => s + (l.Amount||0), 0);
        parts.push(`\n=== LOBBYING SPEND ===`);
        parts.push(`Total lobbying: $${(total/1e6).toFixed(1)}M | Recent: ${lobbying.slice(0,2).map(l => `${l.Issue||l.SpecificIssue||'general'} ($${((l.Amount||0)/1e3).toFixed(0)}K)`).join(', ')}`);
      }

      // Broad market
      parts.push(`\n=== BROAD MARKET CONTEXT ===`);
      if (spy?.c) parts.push(`SPY (S&P 500): $${spy.c.toFixed(2)} | ${spy.dp >= 0 ? '+' : ''}${spy.dp?.toFixed(2)}% — ${spy.dp > 0.5 ? 'Risk-On' : spy.dp < -0.5 ? 'Risk-Off' : 'Neutral'}`);
      if (qqq?.c) parts.push(`QQQ (Nasdaq): $${qqq.c.toFixed(2)} | ${qqq.dp >= 0 ? '+' : ''}${qqq.dp?.toFixed(2)}%`);
      if (vix?.c) parts.push(`VIX: ${vix.c.toFixed(1)} — ${vix.c > 25 ? 'High Fear (>25)' : vix.c > 18 ? 'Elevated Volatility' : 'Low Fear / Complacent'}`);

      contextData = parts.join('\n');
    }

    // Prompt caching: static instructions cached after first call (~90% off repeat input tokens)
    const STATIC_INSTRUCTIONS = [
      {
        type: 'text',
        text: `You are a senior institutional stock analyst delivering a deep-dive analysis.

Write a comprehensive analysis in exactly 4 sections with headers:

1. **Market Context** — How is the broad market and sector performing today? Is this a headwind or tailwind for the stock? Use index percentages and sector ETF moves.
2. **Technical Picture** — Momentum, trend, and key levels. Reference moving averages, RSI, and volume ratios using the data provided. Do NOT mention the current price — describe price behavior relative to MAs (e.g. 'trading above 50MA', 'testing 200MA support') rather than quoting the exact current price.
3. **Fundamental Snapshot** — Key metrics, valuation multiples, growth profile, margins. Use the actual numbers from the data.
4. **News & Catalysts** — What specific news is driving this stock? Name the actual headlines and their market implications. What sector-level catalysts are in play?

CRITICAL: Do NOT quote the exact current stock price anywhere in sections 1-4. Reference price behavior, trend direction, and levels relative to moving averages only. The current price is handled separately.

Be specific with actual numbers from the data (P/E, margins, RSI, MA levels, sector %). Write for a sophisticated institutional investor. No disclaimers.`,
        cache_control: { type: 'ephemeral' }
      }
    ];

    const system = contextData
      ? [
          ...STATIC_INSTRUCTIONS,
          { type: 'text', text: `\nToday\'s live market data for ${ticker}:\n\n${contextData}\n\nUsing ONLY this data, write the analysis.` }
        ]
      : 'You are an institutional stock analyst. Provide a deep-dive analysis in 5 sections: Market Context, Technical Picture, Fundamentals, News & Catalysts, Outlook & Strategy.';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        stream: true,
        system,
        messages
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err.slice(0,300) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── BACKGROUND CACHE SAVE ──
    // Tee the response stream: one branch goes to client, other we collect to save
    if (ticker && resp.ok) {
      const [clientStream, cacheStream] = resp.body.tee();

      // Collect cache stream in background — don't await, don't block client
      (async () => {
        try {
          const reader = cacheStream.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          while(true) {
            const { done, value } = await reader.read();
            if(done) break;
            const chunk = decoder.decode(value);
            // Parse SSE events to extract text
            const lines = chunk.split('\n');
            for(const line of lines) {
              if(!line.startsWith('data:')) continue;
              try {
                const evt = JSON.parse(line.slice(5));
                if(evt.delta?.text) fullText += evt.delta.text;
              } catch(e) {}
            }
          }
          if(fullText.length > 100) {
            // Extract price and headlines from contextData
            const priceMatch = contextData.match(/Price: \$([\d.]+)/);
            const price = priceMatch ? parseFloat(priceMatch[1]) : null;
            const hlMatches = [...contextData.matchAll(/• (.+?)(?:\n|$)/g)].slice(0,10).map(m=>m[1]);
            // Save to cache
            const host = 'pulsestock-nu.vercel.app';
            await fetch(`https://${host}/api/analysis-cache?ticker=${ticker}&action=store`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ analysis: fullText, price, headlines: hlMatches })
            });
            console.log(`[cache] SAVED ${ticker} (${fullText.length} chars)`);
          }
        } catch(e) { console.log(`[cache] Save failed for ${ticker}:`, e.message); }
      })();

      return new Response(clientStream, {
        headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'X-Cache': 'MISS' }
      });
    }

    return new Response(resp.body, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
