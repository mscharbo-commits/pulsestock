export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const type = url.searchParams.get('type') || 'quote';

  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    if (type === 'quote') {
      const [quoteRes, bidAskRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`, { signal: controller.signal }),
        fetch(`https://finnhub.io/api/v1/stock/bidask?symbol=${ticker}&token=${FINNHUB_KEY}`, { signal: controller.signal }),
      ]);
      clearTimeout(timeout);
      const quote = quoteRes.ok ? await quoteRes.json() : {};
      const bidask = bidAskRes.ok ? await bidAskRes.json() : {};

      return new Response(JSON.stringify({
        ticker,
        price: quote.c || 0,
        change: quote.d || 0,
        pct: quote.dp || 0,
        high: quote.h || 0,
        low: quote.l || 0,
        open: quote.o || 0,
        prevClose: quote.pc || 0,
        bid: bidask.b || (quote.c ? quote.c - 0.01 : 0),
        ask: bidask.a || (quote.c ? quote.c + 0.01 : 0),
        bidSize: bidask.bv || 0,
        askSize: bidask.av || 0,
        timestamp: Date.now(),
      }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      });
    }

    // trades and quotes types — return empty gracefully (no paid data source)
    clearTimeout(timeout);
    return new Response(JSON.stringify({ ticker, trades: [], quotes: [], delayed: true, note: 'Real-time trades require premium data subscription' }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    });

  } catch (err) {
    clearTimeout(timeout);
    return new Response(JSON.stringify({ error: err.message, ticker, trades: [], quotes: [] }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
