export const config = { runtime: 'edge' };
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 730);
  if (!ticker) return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://finnhub.io/api/v1/company-news?symbol='+ticker+'&from='+from+'&to='+to+'&token=d95c889r01qihq3l33k0d95c889r01qihq3l33kg',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    const seen = new Set();
    const news = (data||[]).filter(n => {
      if(seen.has(n.headline)) return false;
      seen.add(n.headline);
      return true;
    }).slice(0, 50).map(n => ({
      id: n.id, headline: n.headline, summary: n.summary,
      source: n.source, url: n.url, image: n.image || '',
      datetime: n.datetime, category: n.category
    }));
    return new Response(JSON.stringify(news), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  } catch(err) {
    return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
