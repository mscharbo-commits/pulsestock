export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const results = {};

  const tests = [
    // Google Finance
    ['google_finance', `https://www.google.com/finance/quote/${ticker}:NASDAQ`],
    ['google_finance_search', `https://www.google.com/finance/search?q=${ticker}`],
    // Yahoo Finance
    ['yahoo_summary', `https://finance.yahoo.com/quote/${ticker}/profile/`],
    ['yahoo_api', `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile,summaryProfile`],
    ['yahoo_api2', `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile`],
    // Macrotrends
    ['macrotrends', `https://www.macrotrends.net/stocks/charts/${ticker}/apple/revenue`],
    // Stock Analysis
    ['stockanalysis', `https://stockanalysis.com/stocks/${ticker.toLowerCase()}/company/`],
    ['stockanalysis_api', `https://api.stockanalysis.com/stocks/${ticker.toLowerCase()}/profile/`],
    // Wikipedia
    ['wikipedia', `https://en.wikipedia.org/api/rest_v1/page/summary/${ticker}`],
    // Clearbit / OpenCorporates
    ['clearbit', `https://company.clearbit.com/v2/companies/domain/apple.com`],
  ];

  await Promise.all(tests.map(async ([name, url]) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/json,*/*',
        }
      });
      clearTimeout(t);
      const text = await r.text();
      results[name] = { status: r.status, preview: text.slice(0, 150) };
    } catch(e) { results[name] = { error: e.message.slice(0, 60) }; }
  }));

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
