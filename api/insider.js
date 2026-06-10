export const config = { runtime: 'edge' };

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'No ticker' }), { status: 400, headers: CORS });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const data = await res.json();

    const raw = (data.data || []).filter(t => t.transactionCode === 'P' || t.transactionCode === 'S');
    raw.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const recent = raw.filter(t => new Date(t.transactionDate) >= cutoff);

    const TITLES = { 'Chief Executive Officer': 'CEO', 'Chief Financial Officer': 'CFO', 'Chief Operating Officer': 'COO', 'Chief Technology Officer': 'CTO', 'President': 'President', 'Director': 'Director', 'Chairman': 'Chairman' };
    function cleanTitle(t) {
      if (!t) return '';
      for (const k in TITLES) { if (t.includes(k)) return TITLES[k]; }
      return t.split(' ').slice(0, 3).join(' ');
    }

    const transactions = recent.map(t => ({
      name: t.name || 'Unknown',
      title: cleanTitle(t.officerTitle || ''),
      type: t.transactionCode === 'P' ? 'buy' : 'sell',
      shares: Math.abs(t.change || 0),
      price: t.transactionPrice || null,
      value: Math.abs(t.change || 0) * (t.transactionPrice || 0) || null,
      date: t.transactionDate,
    }));

    return new Response(JSON.stringify({ ticker, transactions, source: 'SEC Form 4 / Finnhub' }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, transactions: [] }), { status: 200, headers: CORS });
  }
}
