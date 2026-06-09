export const config = { runtime: 'edge' };
export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { headers: cors });
  try {
    // Get next 3 months of earnings
    const now = new Date();
    const from = now.toISOString().split('T')[0];
    const to = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const r = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${ticker}&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`
    );
    const data = await r.json();
    const earnings = (data.earningsCalendar || []).slice(0, 5).map(e => ({
      date: e.date,
      hour: e.hour, // 'bmo' (before market open) or 'amc' (after market close)
      epsEstimate: e.epsEstimate,
      epsActual: e.epsActual,
      revenueEstimate: e.revenueEstimate,
      revenueActual: e.revenueActual,
      quarter: e.quarter,
      year: e.year,
    }));
    
    // Also get historical earnings surprises
    const r2 = await fetch(
      `https://finnhub.io/api/v1/stock/earnings?symbol=${ticker}&limit=4&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`
    );
    const hist = await r2.json();
    
    return new Response(JSON.stringify({ upcoming: earnings, history: hist || [] }), { 
      headers: { ...cors, 'Cache-Control': 'public, max-age=3600' } 
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: cors });
  }
}
