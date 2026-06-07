export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const results = {};
  
  const tests = [
    ['house_clerk_xml', 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/2026PTR.xml'],
    ['house_stock_watcher', 'https://raw.githubusercontent.com/house-stock-watcher/house-stock-watcher/main/data/all_transactions.json'],
    ['github_api_search', 'https://api.github.com/search/repositories?q=house+congress+stock+trades&sort=stars&per_page=3'],
    ['efts_sec_ptr', 'https://efts.sec.gov/LATEST/search-index?q=%22Periodic+Transaction%22&dateRange=custom&startdt=2026-05-01&enddt=2026-06-07'],
    ['senate_efds', 'https://efts.sec.gov/LATEST/search-index?q=%22Stock+Act%22&forms=4&dateRange=custom&startdt=2026-05-01&enddt=2026-06-07'],
    ['capitoltrades_api', 'https://capitoltrades.com/api/trades?ticker=AAPL&limit=5'],
    ['wisesheets', 'https://api.wisesheets.io/congress?ticker=AAPL'],
    ['unusual_whales_free', 'https://phx.unusualwhales.com/api/congress?ticker=AAPL'],
  ];

  await Promise.all(tests.map(async ([name, url]) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { 
        signal: ctrl.signal,
        headers: { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'application/json' }
      });
      clearTimeout(t);
      const text = await r.text();
      results[name] = { status: r.status, preview: text.slice(0, 150) };
    } catch(e) {
      results[name] = { error: e.message };
    }
  }));

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
