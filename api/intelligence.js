export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const results = {};

  // Capitol Trades - try with different headers/delay
  const ct_tests = [
    ['capitoltrades_html', 'https://capitoltrades.com/trades?ticker=AAPL', 'text/html'],
    ['capitoltrades_json', 'https://capitoltrades.com/api/trades?politician_id=&ticker=AAPL&page=0&page_size=10', 'application/json'],
    ['capitoltrades_v2', 'https://capitoltrades.com/api/v1/trades?ticker=AAPL', 'application/json'],
    ['capitoltrades_graphql', 'https://capitoltrades.com/api/graphql', 'application/json'],
  ];

  for (const [name, url, accept] of ct_tests) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': accept,
          'Referer': 'https://capitoltrades.com',
        }
      });
      clearTimeout(t);
      const text = await r.text();
      results[name] = { status: r.status, preview: text.slice(0, 200) };
    } catch(e) { results[name] = { error: e.message }; }
  }

  // Check the GitHub repos that were found
  try {
    const r = await fetch('https://api.github.com/search/repositories?q=house+congress+stock+trades&sort=stars&per_page=5', {
      headers: { 'User-Agent': 'PulseStock', 'Accept': 'application/vnd.github.v3+json' }
    });
    const d = await r.json();
    results['github_repos'] = (d.items||[]).map(i => ({ 
      name: i.full_name, stars: i.stargazers_count, 
      branch: i.default_branch, updated: i.updated_at?.slice(0,10) 
    }));
  } catch(e) { results['github_repos'] = { error: e.message }; }

  // Try the house-stock-watcher data from the correct known working URL
  const data_attempts = [
    'https://raw.githubusercontent.com/ArtificialIntelligenceResearch/US-Congress-Stock-Trading/main/data/all_transactions.json',
    'https://raw.githubusercontent.com/neelsomani/political-data/master/data/congress_trades.json',
    'https://raw.githubusercontent.com/unitedstates/congress/main/tasks/README.md',
  ];
  for (const url of data_attempts) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'PulseStock' } });
      const t = await r.text();
      results[url.split('/').slice(-1)[0]] = { status: r.status, preview: t.slice(0, 100) };
    } catch(e) { results[url.split('/').slice(-1)[0]] = { error: e.message }; }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
