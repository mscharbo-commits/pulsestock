export const config = { runtime: 'edge' };

const FINNHUB_KEY   = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const QUIVER_KEY    = process.env.QUIVER_KEY || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function safeFetch(url, opts) {
  try {
    const r = await fetch(url, opts || {});
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? await r.json() : await r.text();
  } catch(e) { return null; }
}

// ── 1. DARK POOL / SHORT SALE VOLUME & DOLLAR FLOW (FINRA CDN) ─────────────
async function getDarkPool(ticker) {
  // Dark pool / RegSHO data — FINRA CDN calls removed (10 calls, slow)
  // Coming soon with proper data provider
  return null;
}

async function getBorrowRate(ticker) {
  // Short data coming soon — Fintel/Quiver integration pending
  // Returns null immediately — no network calls, no timeout delays
  return null;
}

async function get13F(ticker) {
  const headers = { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'application/json' };

  // Search for recent 13F-HR filings mentioning this ticker
  const search = await safeFetch(
    `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=13F-HR&dateRange=custom&startdt=2025-10-01&enddt=2026-06-06&hits.hits._source.period_of_report=true&hits.hits._source.entity_name=true`,
    { headers }
  );
  if (!search || !search.hits?.hits?.length) return null;

  // Get top 15 unique filers
  const seen = new Set();
  const filers = [];
  for (const hit of search.hits.hits) {
    const name = hit._source?.entity_name || hit._source?.display_names?.[0] || 'Unknown';
    if (!seen.has(name) && !name.includes('AAPL') && !name.includes('Apple')) {
      seen.add(name);
      filers.push({
        name,
        filingDate: hit._source?.file_date,
        period: hit._source?.period_of_report,
        accession: hit._source?.file_num,
      });
    }
    if (filers.length >= 15) break;
  }

  const total = search.hits.total?.value || 0;
  return {
    totalFilers: total,
    recentFilers: filers,
    source: 'SEC EDGAR 13F-HR Filings',
    note: `${total} institutional filings reference ${ticker} since Oct 2025`,
  };
}

// ── 4. CONGRESSIONAL TRADING (Quiver Quant — needs free API key) ──────────
async function getCongressional(ticker) {
  if (!QUIVER_KEY) {
    return {
      unavailable: true,
      message: 'Add QUIVER_KEY env var (free at quiverquant.com) to enable congressional trading data',
    };
  }
  const d = await safeFetch(
    `https://api.quiverquant.com/beta/historical/congresstrading/${ticker}`,
    { headers: { 'Accept': 'application/json', 'Authorization': `Token ${QUIVER_KEY}` } }
  );
  if (!d || !Array.isArray(d)) return null;

  const trades = d.slice(0, 20).map(t => ({
    name:        t.Representative || t.Senator,
    chamber:     t.Chamber,
    party:       t.Party,
    transaction: t.Transaction,
    amount:      t.Range,
    date:        t.TransactionDate,
    ticker:      t.Ticker,
  }));
  const buys  = trades.filter(t => t.transaction?.toLowerCase().includes('purchase'));
  const sells = trades.filter(t => t.transaction?.toLowerCase().includes('sale'));
  return { trades, buys: buys.length, sells: sells.length, sentiment: buys.length > sells.length ? 'Bullish' : 'Bearish', source: 'Quiver Quant / Capitol Trades' };
}

// ── 5. OPTIONS SENTIMENT (Finnhub — derive from available data) ───────────
async function getOptionsSentiment(ticker) {
  // Finnhub option-chain is premium. Use what we have:
  // - Basic metrics include put/call data via market sentiment
  // - Use recommendation trends as proxy for options sentiment
  const [rec, peers] = await Promise.all([
    safeFetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/stock/peers?symbol=${ticker}&token=${FINNHUB_KEY}`),
  ]);

  // Recommendation data gives analyst sentiment
  let analystData = null;
  if (rec && Array.isArray(rec) && rec.length) {
    const latest = rec[0];
    const total  = (latest.strongBuy||0) + (latest.buy||0) + (latest.hold||0) + (latest.sell||0) + (latest.strongSell||0);
    const bullish = (latest.strongBuy||0) + (latest.buy||0);
    const bearish = (latest.sell||0) + (latest.strongSell||0);
    analystData = {
      period: latest.period,
      strongBuy:   latest.strongBuy  || 0,
      buy:         latest.buy        || 0,
      hold:        latest.hold       || 0,
      sell:        latest.sell       || 0,
      strongSell:  latest.strongSell || 0,
      total,
      bullishPct:  total ? parseFloat((bullish/total*100).toFixed(1)) : null,
      bearishPct:  total ? parseFloat((bearish/total*100).toFixed(1)) : null,
      consensus:   bullish > bearish ? 'Buy' : bearish > bullish ? 'Sell' : 'Hold',
    };
  }

  // Price target
  const pt = await safeFetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_KEY}`);

  return {
    analystRatings:  analystData,
    priceTarget: pt ? {
      current:  pt.targetMean,
      high:     pt.targetHigh,
      low:      pt.targetLow,
      median:   pt.targetMedian,
      analysts: pt.lastUpdated,
    } : null,
    note: 'Options P/C ratio requires Finnhub premium. Showing analyst ratings & price targets as proxy.',
    source: 'Finnhub Analyst Data',
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  let ticker, feature;
  try {
    const u = new URL(req.url);
    ticker  = u.searchParams.get('ticker')?.toUpperCase();
    feature = u.searchParams.get('feature') || 'all';
  } catch(e) {
    return new Response(JSON.stringify({error:'bad request'}), {status:400,headers:cors});
  }
  if (!ticker) return new Response(JSON.stringify({error:'ticker required'}),{status:400,headers:cors});

  try {
    let result;
    if (feature === 'all') {
      const [darkpool, borrow, institutional, congressional, options] = await Promise.all([
        getDarkPool(ticker),
        getBorrowRate(ticker),
        get13F(ticker),
        getCongressional(ticker),
        getOptionsSentiment(ticker),
      ]);
      result = { darkpool, borrow, institutional, congressional, options };
    } else {
      const map = { darkpool: getDarkPool, borrow: getBorrowRate, institutional: get13F, congressional: getCongressional, options: getOptionsSentiment };
      result = await (map[feature] || (() => ({error:'unknown feature'})))(ticker);
    }

    return new Response(JSON.stringify({ ticker, ...result }), {
      headers: { ...cors, 'Cache-Control': 'public, max-age=1800' }
    });
  } catch(err) {
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:cors});
  }
}
