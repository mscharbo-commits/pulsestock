export const config = { maxDuration: 30 };

export default async function handler(req) {
  const KEY = process.env.FINNHUB_KEY;
  const results = {};
  
  const tests = [
    ['finnhub_options', `https://finnhub.io/api/v1/stock/option-chain?symbol=AAPL&token=${KEY}`],
    ['finnhub_13f', `https://finnhub.io/api/v1/fund-ownership?symbol=AAPL&limit=5&token=${KEY}`],
    ['finnhub_recommendation', `https://finnhub.io/api/v1/stock/recommendation?symbol=AAPL&token=${KEY}`],
    ['finnhub_earnings_quality', `https://finnhub.io/api/v1/stock/earnings-quality?symbol=AAPL&freq=annual&token=${KEY}`],
    ['finnhub_congressional', `https://finnhub.io/api/v1/stock/congressional-trading?symbol=AAPL&token=${KEY}`],
  ];
  
  await Promise.all(tests.map(async ([name, url]) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      const text = await res.text();
      results[name] = { status: res.status, preview: text.slice(0, 100) };
    } catch(e) {
      results[name] = { error: e.message };
    }
  }));
  
  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
  });
}
