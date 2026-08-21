export const config = { runtime: 'edge' };

const FINNHUB = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  try {
    // Step 1: Get full US stock universe from Finnhub
    const symbolsResp = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB}`
    );
    if (!symbolsResp.ok) {
      return new Response(JSON.stringify({ error: `Finnhub symbols ${symbolsResp.status}` }), { headers: CORS });
    }
    const symbols = await symbolsResp.json();

    // Step 2: Apply symbol-level hard filters
    const filtered = symbols.filter(s =>
      s.type === 'Common Stock' &&
      s.symbol &&
      !s.symbol.includes('.') &&
      !s.symbol.includes('/') &&
      s.symbol.length <= 5 &&
      s.currency === 'USD'
    );

    // Step 3: Sample 50 random stocks and get quotes + basic metrics
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 50);

    // Fetch quotes in batches of 10
    const quotes = [];
    for (let i = 0; i < sample.length; i += 10) {
      const batch = sample.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(s =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${s.symbol}&token=${FINNHUB}`)
            .then(r => r.ok ? r.json() : null)
            .then(q => {
              if (!q || !q.c) return null;
              // Finnhub quote fields: c=current, h=high, l=low, o=open, pc=prev close, v=volume
              // v may be 0 or null on free tier — use price only for now
              return {
                ticker: s.symbol,
                price: q.c,
                prevClose: q.pc || 0,
                high: q.h || 0,
                low: q.l || 0,
                volume: q.v || 0,
                dollarVol: q.v ? (q.c * q.v) : 0,
                hasDollarVol: q.v > 0
              };
            })
            .catch(() => null)
        )
      );
      quotes.push(...results.filter(Boolean));
      if (i + 10 < sample.length) await new Promise(r => setTimeout(r, 500));
    }

    // Count how many have volume data
    const withVolume = quotes.filter(q => q.hasDollarVol);
    const withoutVolume = quotes.filter(q => !q.hasDollarVol);

    // Filter 1: Price > $2 only (volume not available on free tier)
    const passingPrice = quotes.filter(q => q.price >= 2.0);

    // Filter 2: Price > $2 AND dollar vol > $500k (only for stocks with volume data)
    const passingBoth = withVolume.filter(q => q.price >= 2.0 && q.dollarVol >= 500000);

    // Pass rate estimates
    const pricePassRate = quotes.length > 0 ? passingPrice.length / quotes.length : 0;
    const bothPassRate = withVolume.length > 0 ? passingBoth.length / withVolume.length : 0;

    // Extrapolate — use price filter as base (conservative)
    const estimatedByPrice = Math.round(filtered.length * pricePassRate);
    // Volume filter typically eliminates another 40-50% on top of price
    const estimatedFinal = Math.round(estimatedByPrice * 0.55);
    const costPerRun = estimatedFinal * 0.055;

    // Price distribution
    const byPrice = { 'under$2':0,'$2-5':0,'$5-10':0,'$10-20':0,'$20-50':0,'$50-100':0,'$100+':0 };
    quotes.forEach(q => {
      if (q.price < 2) byPrice['under$2']++;
      else if (q.price < 5) byPrice['$2-5']++;
      else if (q.price < 10) byPrice['$5-10']++;
      else if (q.price < 20) byPrice['$10-20']++;
      else if (q.price < 50) byPrice['$20-50']++;
      else if (q.price < 100) byPrice['$50-100']++;
      else byPrice['$100+']++;
    });

    // Top stocks by price in sample
    const topStocks = passingPrice
      .sort((a,b) => b.price - a.price)
      .slice(0, 20)
      .map(q => ({
        ticker: q.ticker,
        price: `$${q.price.toFixed(2)}`,
        dollarVol: q.hasDollarVol ? `$${(q.dollarVol/1e6).toFixed(1)}M` : 'no vol data'
      }));

    return new Response(JSON.stringify({
      universe: {
        totalFinnhubUS: symbols.length,
        commonStockUSD: filtered.length,
        sampleSize: quotes.length,
        withPriceData: quotes.filter(q => q.price > 0).length,
        withVolumeData: withVolume.length,
        note: 'Finnhub free tier often returns volume=0 — price filter is more reliable'
      },
      sampleResults: {
        passingPrice: `${passingPrice.length}/${quotes.length} (${(pricePassRate*100).toFixed(1)}%)`,
        passingBothFilters: withVolume.length > 0
          ? `${passingBoth.length}/${withVolume.length} stocks with vol data (${(bothPassRate*100).toFixed(1)}%)`
          : 'No volume data available on free tier'
      },
      projectedSurvivors: {
        byPriceOnly: estimatedByPrice,
        withVolumeFilter: `~${estimatedFinal} (estimated, applying ~45% volume elimination)`,
        range: `${Math.round(estimatedFinal*0.8)}–${Math.round(estimatedFinal*1.2)}`,
      },
      costEstimate: {
        perFridayRun: `$${costPerRun.toFixed(2)}`,
        perMonth4Fridays: `$${(costPerRun*4).toFixed(2)}`,
        model: 'Sonnet + 1 web search + prompt caching @ $0.055/stock'
      },
      samplePriceDistribution: byPrice,
      topStocksInSample: topStocks
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
