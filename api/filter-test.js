export const config = { runtime: 'edge' };

const FINNHUB = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// Valid US exchanges only — no OTC, no pink sheets, no foreign OTC
const VALID_EXCHANGES = new Set([
  'NYSE','NASDAQ','NYSE ARCA','NYSE AMERICAN','CBOE','BATS',
  'NYSE MKT','NASDAQ NMS','NASDAQ SCM','NASDAQ CM','NASDAQ GM'
]);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  try {
    const symbolsResp = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB}`
    );
    if (!symbolsResp.ok) {
      return new Response(JSON.stringify({ error: `Finnhub ${symbolsResp.status}` }), { headers: CORS });
    }
    const symbols = await symbolsResp.json();

    // Show sample of raw fields to understand data structure
    const sampleRaw = symbols.slice(0, 5);

    // Hard filters:
    // 1. Common Stock only
    // 2. USD only
    // 3. No dots or slashes in ticker
    // 4. Ticker length <= 4 (5-letter tickers ending in F/E/K/P are usually OTC foreign/preferred/etc)
    //    Exception: allow 5-letter if exchange is clearly NYSE/NASDAQ
    // 5. No F suffix (foreign OTC indicator)
    // 6. Exchange must be major US exchange
    const filtered = symbols.filter(s => {
      if (!s.symbol || !s.type || !s.currency) return false;
      if (s.type !== 'Common Stock') return false;
      if (s.currency !== 'USD') return false;
      if (s.symbol.includes('.') || s.symbol.includes('/')) return false;

      const sym = s.symbol.toUpperCase();
      // OTC foreign stock indicators — 5-letter ending in F, K, E, P, Y
      if (sym.length === 5 && /[FKEPHY]$/.test(sym)) return false;
      // General length limit
      if (sym.length > 5) return false;

      // Exchange filter — must be major US exchange
      const mic = (s.mic || '').toUpperCase();
      const ex = (s.exchange || '').toUpperCase();
      // XNYS=NYSE, XNAS=NASDAQ, XASE=NYSE American, ARCX=NYSE Arca, BATS=CBOE
      const validMIC = ['XNYS','XNAS','XASE','ARCX','BATS','XCBO','EDGX','EDGA'].includes(mic);
      const validEX = ex.includes('NYSE') || ex.includes('NASDAQ') || ex.includes('CBOE') || ex.includes('BATS');

      return validMIC || validEX;
    });

    // Show exchange breakdown of filtered universe
    const exchangeCounts = {};
    filtered.forEach(s => {
      const key = s.mic || s.exchange || 'unknown';
      exchangeCounts[key] = (exchangeCounts[key] || 0) + 1;
    });

    // Sample 50 for quote testing
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
              if (!q || !q.c || q.c === 0) return null;
              return {
                ticker: s.symbol,
                exchange: s.mic || s.exchange,
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

    const passingPrice = quotes.filter(q => q.price >= 2.0);
    const withVol = quotes.filter(q => q.hasVol);
    const passingBoth = withVol.filter(q => q.price >= 2.0 && q.dollarVol >= 500000);

    const priceRate = quotes.length > 0 ? passingPrice.length / quotes.length : 0;
    const volRate = withVol.length > 0 ? passingBoth.length / withVol.length : 0.55;

    const byPrice = Math.round(filtered.length * priceRate);
    const estimated = Math.round(filtered.length * Math.min(priceRate, 1) * (withVol.length > 5 ? volRate : 0.55));
    const costMid = estimated * 0.055;

    const dist = {'under$2':0,'$2-5':0,'$5-10':0,'$10-20':0,'$20-50':0,'$50-100':0,'$100-500':0,'$500+':0};
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

    const top = passingPrice
      .sort((a,b) => b.price - a.price)
      .slice(0, 15)
      .map(q => ({ ticker: q.ticker, exchange: q.exchange, price: `$${q.price.toFixed(2)}` }));

    return new Response(JSON.stringify({
      rawSampleFields: Object.keys(sampleRaw[0] || {}),
      universe: {
        totalFinnhubUS: symbols.length,
        afterSymbolFilter: filtered.length,
        exchangeBreakdown: exchangeCounts
      },
      sample: {
        size: quotes.length,
        passingPrice: `${passingPrice.length}/${quotes.length} (${(priceRate*100).toFixed(1)}%)`,
        withVolData: withVol.length,
        passingBoth: withVol.length > 0 ? `${passingBoth.length}/${withVol.length}` : 'no vol data'
      },
      projected: {
        afterPriceFilter: byPrice,
        afterAllFilters: estimated,
        range: `${Math.round(estimated*0.8).toLocaleString()}–${Math.round(estimated*1.2).toLocaleString()}`
      },
      cost: {
        perFridayRun: `$${costMid.toFixed(2)}`,
        perMonth: `$${(costMid*4).toFixed(2)}`
      },
      priceDistribution: dist,
      topStocks: top
    }, null, 2), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
