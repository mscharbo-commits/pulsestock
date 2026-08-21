export const config = { runtime: 'edge' };

const FINNHUB = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  try {
    // Step 1: Full US stock universe from Finnhub
    const symbolsResp = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB}`
    );
    if (!symbolsResp.ok) {
      return new Response(JSON.stringify({ error: `Finnhub ${symbolsResp.status}` }), { headers: CORS });
    }
    const symbols = await symbolsResp.json();

    // Step 2: Symbol-level filters
    // - Common Stock only (no ETFs, warrants, preferreds, REITs structured products)
    // - USD denominated
    // - Clean ticker (no dots, slashes, length <= 5)
    // - NO upper market cap limit — NVDA, AAPL, MSFT all included
    // - NO lower market cap limit at symbol level — price filter handles this
    const filtered = symbols.filter(s =>
      s.type === 'Common Stock' &&
      s.symbol &&
      !s.symbol.includes('.') &&
      !s.symbol.includes('/') &&
      s.symbol.length <= 5 &&
      s.currency === 'USD'
    );

    // Step 3: Sample 50 random stocks — fetch live quotes
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 50);

    const quotes = [];
    for (let i = 0; i < sample.length; i += 10) {
      const batch = sample.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(s =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${s.symbol}&token=${FINNHUB}`)
            .then(r => r.ok ? r.json() : null)
            .then(q => {
              if (!q || q.c === 0 || q.c === null) return null;
              return {
                ticker: s.symbol,
                price: q.c,
                volume: q.v || 0,
                dollarVol: q.v ? (q.c * q.v) : 0,
                hasVol: (q.v || 0) > 0
              };
            })
            .catch(() => null)
        )
      );
      quotes.push(...results.filter(Boolean));
      if (i + 10 < sample.length) await new Promise(r => setTimeout(r, 400));
    }

    // Step 4: Apply price filter (> $2, no upper limit)
    const passingPrice = quotes.filter(q => q.price >= 2.0);

    // Step 5: Dollar volume filter for stocks that have volume data
    const withVol = quotes.filter(q => q.hasVol);
    const passingBoth = withVol.filter(q => q.price >= 2.0 && q.dollarVol >= 500000);

    // Pass rates
    const priceRate = quotes.length > 0 ? passingPrice.length / quotes.length : 0;
    const volRate = withVol.length > 0 ? passingBoth.length / withVol.length : priceRate * 0.55;

    // Projected survivors — no upper cap, just price + volume
    const byPrice = Math.round(filtered.length * priceRate);
    const withVolEst = Math.round(filtered.length * volRate);

    // Cost estimates
    const costLow  = Math.round(withVolEst * 0.8) * 0.055;
    const costHigh = Math.round(withVolEst * 1.2) * 0.055;
    const costMid  = withVolEst * 0.055;

    // Price distribution
    const dist = { 'under$2':0,'$2-5':0,'$5-10':0,'$10-20':0,'$20-50':0,'$50-100':0,'$100-500':0,'$500+':0 };
    quotes.forEach(q => {
      if (q.price < 2) dist['under$2']++;
      else if (q.price < 5) dist['$2-5']++;
      else if (q.price < 10) dist['$5-10']++;
      else if (q.price < 20) dist['$10-20']++;
      else if (q.price < 50) dist['$20-50']++;
      else if (q.price < 100) dist['$50-100']++;
      else if (q.price < 500) dist['$100-500']++;
      else dist['$500+']++;
    });

    // Top passing stocks in sample
    const top = passingPrice
      .sort((a,b) => b.price - a.price)
      .slice(0, 15)
      .map(q => ({
        ticker: q.ticker,
        price: `$${q.price.toFixed(2)}`,
        dollarVol: q.hasVol ? `$${(q.dollarVol/1e6).toFixed(1)}M` : 'no vol on free tier'
      }));

    return new Response(JSON.stringify({
      universe: {
        totalFinnhubUS: symbols.length,
        afterSymbolFilter: filtered.length,
        note: 'No upper market cap limit — NVDA/AAPL/MSFT/TSLA all included'
      },
      sample: {
        size: quotes.length,
        passingPrice: `${passingPrice.length} of ${quotes.length} (${(priceRate*100).toFixed(1)}%)`,
        withVolData: withVol.length,
        passingBothFilters: withVol.length > 0
          ? `${passingBoth.length} of ${withVol.length} with vol data (${(volRate*100).toFixed(1)}%)`
          : 'Volume not available on Finnhub free tier — using estimated 55% pass rate'
      },
      projected: {
        afterPriceFilter: byPrice,
        afterPriceAndVolume: withVolEst,
        range: `${Math.round(withVolEst*0.8).toLocaleString()}–${Math.round(withVolEst*1.2).toLocaleString()}`,
        note: 'Extrapolated from random 50-stock sample'
      },
      costPerFridayRun: {
        low: `$${costLow.toFixed(2)}`,
        mid: `$${costMid.toFixed(2)}`,
        high: `$${costHigh.toFixed(2)}`,
        perMonth4Fridays: `$${(costMid*4).toFixed(2)}`,
        model: 'Sonnet + 1 web search + prompt caching @ $0.055/stock'
      },
      filters: {
        minPrice: '$2.00',
        maxPrice: 'NONE — no upper limit',
        minDollarVolume: '$500k/day',
        maxMarketCap: 'NONE — no upper limit',
        type: 'Common Stock USD only',
        excluded: 'dots, slashes in ticker, length > 5'
      },
      priceDistributionSample: dist,
      topStocksSample: top
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
