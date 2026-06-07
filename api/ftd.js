export const config = { maxDuration: 15 };

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  
  const results = {};
  
  // Test each domain with a 5s timeout
  const tests = [
    ['nasdaq', 'https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqpla20260604.txt'],
    ['nyse',   'https://www.nyse.com/api/regulatory/threshold-securities/download?selectedDate=04-Jun-2026'],
    ['finra',  'https://api.finra.org/data/group/otcMarket/name/ThresholdList'],
  ];
  
  for (const [name, url] of tests) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const start = Date.now();
      const res = await fetch(url, {
        method: name === 'finra' ? 'POST' : 'GET',
        headers: { 'User-Agent': 'PulseStock/1.0', 'Content-Type': 'application/json' },
        body: name === 'finra' ? JSON.stringify({ limit: 1 }) : undefined,
        signal: ctrl.signal,
      });
      results[name] = { status: res.status, ms: Date.now() - start };
    } catch(e) {
      results[name] = { error: e.message };
    }
  }
  
  return new Response(JSON.stringify(results), { headers: cors });
}
