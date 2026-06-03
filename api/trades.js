export const config = { runtime: 'edge' };

const MASSIVE_KEY = '3495_3DnKOgUI1UI9OI57JRBRD8Ghg2c';
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
  const type = url.searchParams.get('type') || 'quote'; // quote or trades

  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (type === 'quote') {
      // Real-time bid/ask from Finnhub
      const [quoteRes, bidAskRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`),
        fetch(`https://finnhub.io/api/v1/stock/bidask?symbol=${ticker}&token=${FINNHUB_KEY}`),
      ]);
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

    if (type === 'trades') {
      // Recent trades from Massive (delayed)
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `https://api.massive.com/v3/trades/${ticker}?timestamp=${today}&limit=50&order=desc&apiKey=${MASSIVE_KEY}`
      );
      if (!res.ok) throw new Error('Trades fetch failed: ' + res.status);
      const data = await res.json();
      const trades = (data.results || []).map(t => ({
        price: t.p,
        size: t.s,
        timestamp: t.t,
        exchange: t.x,
        conditions: t.c,
        id: t.i,
      }));
      return new Response(JSON.stringify({ ticker, trades, delayed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      });
    }

    if (type === 'quotes') {
      // NBBO quotes from Massive (delayed) - closest to Level II top of book
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `https://api.massive.com/v3/quotes/${ticker}?timestamp=${today}&limit=20&order=desc&apiKey=${MASSIVE_KEY}`
      );
      if (!res.ok) throw new Error('Quotes fetch failed: ' + res.status);
      const data = await res.json();
      const quotes = (data.results || []).map(q => ({
        bid: q.bp,
        ask: q.ap,
        bidSize: q.bs,
        askSize: q.as,
        bidExchange: q.bx,
        askExchange: q.ax,
        timestamp: q.t,
      }));
      return new Response(JSON.stringify({ ticker, quotes, delayed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
