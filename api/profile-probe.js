export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const results = {};

  // Google Finance - try different URL formats and extract description
  const googleUrls = [
    `https://www.google.com/finance/quote/${ticker}:NASDAQ`,
    `https://www.google.com/finance/quote/${ticker}:NYSE`,
    `https://www.google.com/finance/quote/${ticker}:NYSEARCA`,
  ];

  for (const url of googleUrls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!r.ok) continue;
      const html = await r.text();

      // Try multiple patterns for description in Google Finance HTML
      const patterns = [
        /data-attrid="description"[^>]*>\s*<span[^>]*>([\s\S]{50,1000}?)<\/span>/,
        /"description":"([^"]{50,500})"/,
        /class="bLLb2d[^>]*>([^<]{100,800})<\/span>/,
        /class="[^"]*description[^"]*"[^>]*>([^<]{50,500})</,
        /"about":"([^"]{50,500})"/,
        /itemprop="description"[^>]*>([^<]{50,500})</,
        // Google Finance specific
        /"Biz":\{"description":"([^"]{50,500})"/,
        /\["([A-Z][^"]{49,499})"\s*,\s*"About [^"]+"\]/,
      ];

      for (const pat of patterns) {
        const m = html.match(pat);
        if (m) {
          results[url.split('/').pop()] = { found: true, pattern: pat.source.slice(0,40), desc: m[1].slice(0,200) };
          break;
        }
      }

      if (!results[url.split('/').pop()]) {
        // Show what's around "About" or "description" in the HTML
        const aboutIdx = html.indexOf('About ' + ticker);
        const descIdx = html.indexOf('"description"');
        results[url.split('/').pop()] = {
          found: false,
          htmlSize: html.length,
          aboutAt: aboutIdx,
          descAt: descIdx,
          descContext: descIdx > 0 ? html.slice(descIdx, descIdx+200) : 'none',
          aboutContext: aboutIdx > 0 ? html.slice(aboutIdx, aboutIdx+200) : 'none',
        };
      }
      break; // stop after first 200 response
    } catch(e) { results[url.split('/').pop()] = { error: e.message }; }
  }

  // Also try DBpedia (structured Wikipedia data as JSON)
  try {
    const r = await fetch(`https://dbpedia.org/data/${ticker}.json`, { headers: { 'Accept': 'application/json', 'User-Agent': 'PulseStock/1.0' } });
    results.dbpedia_ticker = { status: r.status };
  } catch(e) { results.dbpedia_ticker = { error: e.message }; }

  // Try Wikidata for company description
  try {
    const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${ticker}&language=en&format=json&limit=3`, { headers: { 'User-Agent': 'PulseStock/1.0' } });
    const d = await r.json();
    results.wikidata = { hits: d.search?.slice(0,3).map(s => ({ id: s.id, label: s.label, description: s.description })) };
  } catch(e) { results.wikidata = { error: e.message }; }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
