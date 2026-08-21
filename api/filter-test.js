export const config = { runtime: 'edge' };

const POLYGON = '2c90554e-b7d3-485f-a497-b350eb8136f5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  try {
    // Most recent weekday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];

    const resp = await fetch(
      `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${POLYGON}`
    );
    if (!resp.ok) return new Response(JSON.stringify({ error: `Polygon ${resp.status}`, date: dateStr }), { headers: CORS });

    const data = await resp.json();
    if (!data.results?.length) return new Response(JSON.stringify({ error: 'No results', date: dateStr }), { headers: CORS });

    const all = data.results;

    // Hard filters: price > $2, dollar volume > $500k, no warrants/preferreds
    const filtered = all.filter(s =>
      s.T && !s.T.includes('.') && !s.T.includes('/') && s.T.length <= 5 &&
      s.c >= 2.0 && s.v >= 10000 && (s.c * s.v) >= 500000
    );

    // Price distribution
    const byPrice = { '$2-5':0,'$5-10':0,'$10-20':0,'$20-50':0,'$50-100':0,'$100-200':0,'$200+':0 };
    const byDV    = { '$500k-1M':0,'$1M-5M':0,'$5M-25M':0,'$25M-100M':0,'$100M+':0 };

    filtered.forEach(s => {
      const p = s.c, dv = s.c * s.v;
      if (p < 5) byPrice['$2-5']++;
      else if (p < 10) byPrice['$5-10']++;
      else if (p < 20) byPrice['$10-20']++;
      else if (p < 50) byPrice['$20-50']++;
      else if (p < 100) byPrice['$50-100']++;
      else if (p < 200) byPrice['$100-200']++;
      else byPrice['$200+']++;

      if (dv < 1e6) byDV['$500k-1M']++;
      else if (dv < 5e6) byDV['$1M-5M']++;
      else if (dv < 25e6) byDV['$5M-25M']++;
      else if (dv < 100e6) byDV['$25M-100M']++;
      else byDV['$100M+']++;
    });

    // Top 30 and bottom 20 by dollar volume
    const sorted = [...filtered].sort((a,b) => (b.c*b.v)-(a.c*a.v));
    const top30 = sorted.slice(0,30).map(s => ({
      ticker: s.T, price: `$${s.c.toFixed(2)}`,
      dollarVol: `$${((s.c*s.v)/1e6).toFixed(1)}M`,
      vol: Math.round(s.v).toLocaleString()
    }));
    const bottom20 = sorted.slice(-20).map(s => ({
      ticker: s.T, price: `$${s.c.toFixed(2)}`,
      dollarVol: `$${((s.c*s.v)/1000).toFixed(0)}k`,
      vol: Math.round(s.v).toLocaleString()
    }));

    const costPerRun = filtered.length * 0.055;

    return new Response(JSON.stringify({
      date: dateStr,
      summary: {
        totalFromPolygon: all.length,
        afterFilter: filtered.length,
        filterEliminated: `${((1 - filtered.length/all.length)*100).toFixed(1)}%`,
        costPerFridayRun: `$${costPerRun.toFixed(2)}`,
        costPerMonth4Fridays: `$${(costPerRun*4).toFixed(2)}`,
        note: 'Sonnet + 1 web search + prompt caching per stock'
      },
      filters: { minPrice: '$2.00', minDollarVolume: '$500k/day' },
      priceDistribution: byPrice,
      dollarVolumeDistribution: byDV,
      top30ByDollarVolume: top30,
      bottom20NearThreshold: bottom20
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
