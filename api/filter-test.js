import { NextResponse } from 'next/server';

export const config = { maxDuration: 60 };

const POLYGON = process.env.POLYGON_API_KEY || '2c90554e-b7d3-485f-a497-b350eb8136f5';
const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

async function safeFetch(url, timeout = 8000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  try {
    // Get yesterday's grouped daily aggs from Polygon
    // This gives us price, volume, market cap proxy for ALL US stocks
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    // Skip weekends
    if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 2);
    if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    console.log(`Fetching grouped daily aggs for ${dateStr}...`);

    const data = await safeFetch(
      `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${POLYGON}`,
      30000
    );

    if (!data || !data.results) {
      return new Response(JSON.stringify({ error: 'No data from Polygon' }), { headers: CORS });
    }

    const allStocks = data.results;
    console.log(`Total stocks from Polygon: ${allStocks.length}`);

    // Apply hard filters
    const filtered = allStocks.filter(s => {
      // Must have ticker (no dots = no preferred shares/warrants)
      if (!s.T || s.T.includes('.') || s.T.includes('/')) return false;

      // Price > $2
      if (!s.c || s.c < 2.0) return false;

      // Dollar volume > $500k (price × volume)
      const dollarVolume = s.c * (s.v || 0);
      if (dollarVolume < 500000) return false;

      // Must have volume
      if (!s.v || s.v < 10000) return false;

      return true;
    });

    console.log(`After price + volume filter: ${filtered.length}`);

    // Now apply market cap filter using Finnhub
    // But we can't call Finnhub for 3000+ stocks — use market cap proxy
    // Market cap = shares outstanding × price
    // Polygon vw (volume weighted) and v (volume) give us a proxy
    // Better: filter by price range as market cap proxy
    // Stocks $2-$10 with low volume are likely micro-cap
    // We'll use Polygon's market cap from reference data for a sample

    // For the test, apply soft market cap proxy:
    // Dollar volume > $500k AND price > $2 already eliminates most micro-caps
    // Add: average volume proxy — if vw × v > $50M market cap proxy threshold

    // Actually let's just show the distribution
    const priceRanges = {
      '$2-5': 0, '$5-10': 0, '$10-20': 0, '$20-50': 0,
      '$50-100': 0, '$100-200': 0, '$200+': 0
    };

    const dollarVolRanges = {
      '$500k-1M': 0, '$1M-5M': 0, '$5M-10M': 0,
      '$10M-50M': 0, '$50M-100M': 0, '$100M+': 0
    };

    filtered.forEach(s => {
      const p = s.c;
      if (p < 5) priceRanges['$2-5']++;
      else if (p < 10) priceRanges['$5-10']++;
      else if (p < 20) priceRanges['$10-20']++;
      else if (p < 50) priceRanges['$20-50']++;
      else if (p < 100) priceRanges['$50-100']++;
      else if (p < 200) priceRanges['$100-200']++;
      else priceRanges['$200+']++;

      const dv = s.c * s.v;
      if (dv < 1000000) dollarVolRanges['$500k-1M']++;
      else if (dv < 5000000) dollarVolRanges['$1M-5M']++;
      else if (dv < 10000000) dollarVolRanges['$5M-10M']++;
      else if (dv < 50000000) dollarVolRanges['$10M-50M']++;
      else if (dv < 100000000) dollarVolRanges['$50M-100M']++;
      else dollarVolRanges['$100M+']++;
    });

    // Apply market cap proxy — dollar volume > $1M/day suggests > $50M market cap
    // (a $50M company typically trades 1-2% of market cap daily)
    const withMarketCapProxy = filtered.filter(s => {
      const dollarVolume = s.c * s.v;
      // $500k daily dollar volume with price > $2 → likely > $50M market cap
      // Additional filter: not a tiny float stock
      return dollarVolume >= 500000;
    });

    // Top candidates by dollar volume
    const top20 = [...filtered]
      .sort((a, b) => (b.c * b.v) - (a.c * a.v))
      .slice(0, 20)
      .map(s => ({
        ticker: s.T,
        price: s.c.toFixed(2),
        volume: Math.round(s.v).toLocaleString(),
        dollarVolume: `$${((s.c * s.v) / 1000000).toFixed(1)}M`
      }));

    // Sample of low end (likely micro-cap)
    const bottom20 = [...filtered]
      .sort((a, b) => (a.c * a.v) - (b.c * b.v))
      .slice(0, 20)
      .map(s => ({
        ticker: s.T,
        price: s.c.toFixed(2),
        volume: Math.round(s.v).toLocaleString(),
        dollarVolume: `$${((s.c * s.v) / 1000000).toFixed(2)}M`
      }));

    // Estimate Sonnet cost
    const SONNET_PER_STOCK = 0.055; // with web search, with caching
    const estimatedCost = filtered.length * SONNET_PER_STOCK;

    return new Response(JSON.stringify({
      date: dateStr,
      summary: {
        totalFromPolygon: allStocks.length,
        afterPriceVolumeFilter: filtered.length,
        estimatedSonnetCostPerRun: `$${estimatedCost.toFixed(2)}`,
        estimatedMonthlyCost: `$${(estimatedCost * 4).toFixed(2)} (4 Fridays)`,
      },
      priceDistribution: priceRanges,
      dollarVolumeDistribution: dollarVolRanges,
      top20ByDollarVolume: top20,
      bottom20ByDollarVolume: bottom20,
      filterCriteria: {
        minPrice: 2.00,
        minDollarVolume: 500000,
        excludes: 'tickers with dots or slashes (warrants, preferred shares)'
      }
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
