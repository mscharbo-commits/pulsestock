export const config = { runtime: 'edge' };

const GIST_TOKEN = process.env.GITHUB_TOKEN;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const r = await fetch(`https://api.github.com/gists/${PICKS_GIST}`,
      { headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'User-Agent': 'PulseStock' } });
    const data = await r.json();

    const cache = JSON.parse(data?.files?.['picks_cache.json']?.content || '{}');
    const performance = JSON.parse(data?.files?.['picks_performance.json']?.content || '{}');

    return new Response(JSON.stringify({ ...cache, performance: performance.picks || [] }), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message, picks: [] }), { status: 500, headers: CORS });
  }
}
