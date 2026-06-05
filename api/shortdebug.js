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
    const text = await res.text();
    // Find the section around "Short Interest"
    const idx = text.indexOf('Current Short Interest');
    const section = idx !== -1 ? text.substring(idx - 100, idx + 3000) : 'NOT FOUND - searching...';
    
    // Also try finding the data table
    const idx2 = text.indexOf('138');
    const section2 = idx2 !== -1 ? text.substring(idx2 - 200, idx2 + 500) : 'number not found';

    return new Response(JSON.stringify({ 
      length: text.length,
      shortInterestSection: section,
      numberContext: section2,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
