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

    // Step 2: Apply hard filters on symbol data alone (no price yet)
    // type=Common Stock, no dots/slashes, ticker length <= 5
    const filtered = symbols.filter(s =>
      s.type === 'Common Stock' &&
      s.symbol &&
      !s.symbol.includes('.') &&
      !s.symbol.includes('/') &&
      s.symbol.length <= 5 &&
      s.currency === 'USD'
    );

    // Step 3: Sample 50 random stocks and get quotes to estimate
    // price > $2 and dollar volume > $500k filter pass rate
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
            .then(q => q ? { ticker: s.symbol, price: q.c, volume: q.v || 0, dollarVol: (q.c || 0) * (q.v || 0) } : null)
            .catch(() => null)
        )
      );
      quotes.push(...results.filter(Boolean));
      // Small delay to respect rate limits
      if (i + 10 < sample.length) await new Promise(r => setTimeout(r, 500));
    }

    // Apply price + dollar volume filter to sample
    const passingSample = quotes.filter(q => q.price >= 2.0 && q.dollarVol >= 500000);
    const passRate = quotes.length > 0 ? passingSample.length / quotes.length : 0;

    // Extrapolate to full universe
    const estimatedSurvivors = Math.round(filtered.length * passRate);
    const costPerRun = estimatedSurvivors * 0.055;

    // Price distribution of sample
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

    // Top passing stocks in sample
    const topStocks = passingSample
      .sort((a,b) => b.dollarVol - a.dollarVol)
      .slice(0, 20)
      .map(q => ({
        ticker: q.ticker,
        price: `$${q.price.toFixed(2)}`,
        dollarVol: `$${(q.dollarVol/1e6).toFixed(1)}M`
      }));

    return new Response(JSON.stringify({
      universe: {
        totalFinnhubUS: symbols.length,
        commonStockUSD: filtered.length,
        sampleSize: quotes.length,
        samplePassing: passingSample.length,
        passRate: `${(passRate*100).toFixed(1)}%`
      },
      projectedSurvivors: {
        estimated: estimatedSurvivors,
        range: `${Math.round(estimatedSurvivors*0.8)}–${Math.round(estimatedSurvivors*1.2)}`,
        note: 'Extrapolated from 50-stock random sample'
      },
      costEstimate: {
        perFridayRun: `$${costPerRun.toFixed(2)}`,
        perMonth4Fridays: `$${(costPerRun*4).toFixed(2)}`,
        model: 'Sonnet + 1 web search + prompt caching per stock @ $0.055'
      },
      filters: {
        type: 'Common Stock only',
        currency: 'USD only',
        minPrice: '$2.00',
        minDollarVolume: '$500k/day',
        excluded: 'tickers with dots, slashes, length > 5'
      },
      samplePriceDistribution: byPrice,
      topStocksInSample: topStocks
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
