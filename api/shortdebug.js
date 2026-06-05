export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const res = await fetch('https://www.marketbeat.com/stocks/NASDAQ/AAPL/short-interest/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        'Accept': 'text/html',
      }
    });
    const status = res.status;
    const text = await res.text();
    // Return first 2000 chars so we can see what we're getting
    return new Response(JSON.stringify({ status, preview: text.substring(0, 2000), length: text.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
