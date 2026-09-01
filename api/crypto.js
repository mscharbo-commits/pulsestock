export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function cg(path, t=8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), t);
  try {
    const r = await fetch('https://api.coingecko.com/api/v3' + path, {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PulseStock/1.0',
      }
    });
    clearTimeout(id);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { clearTimeout(id); return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const { searchParams } = new URL(req.url);
  const coinId = (searchParams.get('id') || '').toLowerCase().trim();
  if (!coinId) return new Response(JSON.stringify({ error: 'No coin ID' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const data = await cg('/coins/' + coinId + '?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false');

  if (!data || data.error) {
    return new Response(JSON.stringify({ error: 'Coin not found' }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
  });
}
