export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const results = {};

  // Check the repos updated today - they might have fresh data files
  const dataFiles = [
    'https://raw.githubusercontent.com/lacygus/Stocks-Trades/master/trades.json',
    'https://raw.githubusercontent.com/lacygus/Stocks-Trades/master/all_transactions.json',
    'https://raw.githubusercontent.com/lacygus/Stocks-Trades/master/data.json',
    'https://raw.githubusercontent.com/johnisanerd/Apify-Congressional-Trading-Data-Scraper/main/data/trades.json',
    'https://raw.githubusercontent.com/johnisanerd/Apify-Congressional-Trading-Data-Scraper/main/dataset.json',
    'https://raw.githubusercontent.com/ivanma9/CongressionalTrading/main/data/trades.json',
    'https://raw.githubusercontent.com/ivanma9/CongressionalTrading/main/trades.json',
  ];

  await Promise.all(dataFiles.map(async url => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'PulseStock' } });
      const t = await r.text();
      results[url.split('/').slice(3,5).join('/')] = { status: r.status, preview: t.slice(0, 150) };
    } catch(e) { results[url.split('/').slice(3,5).join('/')] = { error: e.message }; }
  }));

  // Also check GitHub API for file listings in these repos
  const repoChecks = [
    'https://api.github.com/repos/lacygus/Stocks-Trades/contents/',
    'https://api.github.com/repos/johnisanerd/Apify-Congressional-Trading-Data-Scraper/contents/',
  ];
  await Promise.all(repoChecks.map(async url => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'PulseStock', 'Accept': 'application/vnd.github.v3+json' } });
      const d = await r.json();
      const key = url.split('/repos/')[1].split('/contents')[0];
      results['files_'+key] = Array.isArray(d) ? d.map(f => f.name) : d;
    } catch(e) { results['files'] = { error: e.message }; }
  }));

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
