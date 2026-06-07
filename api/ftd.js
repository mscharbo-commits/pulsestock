// Reads pre-fetched Reg SHO data from Edge Config (instant, no external fetch)
// Data is refreshed daily by /api/cron-regsho

export const config = { maxDuration: 10 };

async function readFromEdgeConfig() {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const ecToken = process.env.EDGE_CONFIG_TOKEN;

  if (!edgeConfigId || !ecToken) return null;

  const res = await fetch(
    `https://edge-config.vercel.com/${edgeConfigId}/item/regsho?token=${ecToken}`
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  let ticker;
  try {
    const base = req.url.startsWith('http') ? '' : 'https://x.com';
    ticker = new URL(base + req.url).searchParams.get('ticker')?.toUpperCase();
  } catch {
    const qs = (req.url.split('?')[1] || '');
    ticker = Object.fromEntries(qs.split('&').map(p => p.split('='))).ticker?.toUpperCase();
  }

  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), {
    status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
  });

  try {
    const cached = await readFromEdgeConfig();

    if (!cached || !cached.tickers) {
      return new Response(JSON.stringify({
        ticker, onRegSHO: false, consecutiveDays: 0, daysOnListLast10: 0,
        error: 'Cache not populated yet — run /api/cron-regsho to initialize',
        source: 'Edge Config (empty)',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const onList = cached.tickers.includes(ticker);

    return new Response(JSON.stringify({
      ticker,
      onRegSHO: onList,
      consecutiveDays: onList ? 1 : 0, // single-day snapshot; history tracked by cron
      daysOnListLast10: onList ? 1 : 0,
      date: cached.date,
      fetchedAt: cached.fetchedAt,
      totalOnList: cached.counts?.total,
      source: 'FINRA + Nasdaq + NYSE (cached)',
      note: 'Refreshed daily at 6 AM ET via cron job',
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
