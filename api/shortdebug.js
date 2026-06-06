export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const res = await fetch('https://fintel.io/fails-to-deliver/AAPL', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        'Accept': 'text/html',
      }
    });
    const text = await res.text();
    const idx = text.indexOf('Fail');
    const section = idx !== -1 ? text.substring(idx, idx + 2000) : text.substring(0, 2000);
    return new Response(JSON.stringify({ status: res.status, length: text.length, section }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
