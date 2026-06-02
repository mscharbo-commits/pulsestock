export const config = { runtime: 'edge' };
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q) return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=true', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' }
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    const quotes = (data.quotes || []).filter(q => q.symbol && (q.shortname || q.longname) && q.quoteType !== 'OPTION' && q.quoteType !== 'FUTURE').slice(0, 8).map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchange || q.exchDisp || '', type: q.quoteType || 'EQUITY' }));
    return new Response(JSON.stringify(quotes), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
