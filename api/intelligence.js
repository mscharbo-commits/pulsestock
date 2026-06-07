export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function ff(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

// ── OPTIONS P/C RATIO ──
async function getOptions(ticker) {
  // Finnhub: /stock/option-chain returns puts/calls per expiry
  const d = await ff(`https://finnhub.io/api/v1/stock/option-chain?symbol=${ticker}&token=${FINNHUB_KEY}`);
  if (!d || !d.data || !d.data.length) return null;

  let totalCalls = 0, totalPuts = 0, totalCallVol = 0, totalPutVol = 0;
  let totalCallOI = 0, totalPutOI = 0;

  // Use nearest 3 expiries for relevance
  const expiries = d.data.slice(0, 3);
  for (const exp of expiries) {
    for (const c of (exp.options?.CALL || [])) {
      totalCalls++;
      totalCallVol += c.volume || 0;
      totalCallOI  += c.openInterest || 0;
    }
    for (const p of (exp.options?.PUT || [])) {
      totalPuts++;
      totalPutVol += p.volume || 0;
      totalPutOI  += p.openInterest || 0;
    }
  }

  const volRatio = totalCallVol > 0 ? (totalPutVol / totalCallVol) : null;
  const oiRatio  = totalCallOI  > 0 ? (totalPutOI  / totalCallOI)  : null;
  const sentiment = volRatio ? (volRatio < 0.7 ? 'Bullish' : volRatio > 1.3 ? 'Bearish' : 'Neutral') : null;

  return {
    putCallVolumeRatio: volRatio ? parseFloat(volRatio.toFixed(3)) : null,
    putCallOIRatio:     oiRatio  ? parseFloat(oiRatio.toFixed(3))  : null,
    totalCallVolume: totalCallVol,
    totalPutVolume:  totalPutVol,
    totalCallOI, totalPutOI,
    sentiment,
    expiryCount: d.data.length,
  };
}

// ── 13F INSTITUTIONAL OWNERSHIP ──
async function get13F(ticker) {
  const d = await ff(`https://finnhub.io/api/v1/fund-ownership?symbol=${ticker}&limit=20&token=${FINNHUB_KEY}`);
  if (!d || !d.ownership || !d.ownership.length) return null;

  const holdings = d.ownership.map(h => ({
    name:       h.name,
    shares:     h.share,
    value:      h.value,
    change:     h.change,
    changePct:  h.changePercent,
    reportDate: h.reportDate,
  }));

  const totalValue    = holdings.reduce((s, h) => s + (h.value || 0), 0);
  const netChange     = holdings.reduce((s, h) => s + (h.change || 0), 0);
  const buyers        = holdings.filter(h => h.change > 0);
  const sellers       = holdings.filter(h => h.change < 0);
  const sentiment     = buyers.length > sellers.length ? 'Accumulating' : sellers.length > buyers.length ? 'Distributing' : 'Mixed';

  return { holdings, totalValue, netChange, buyers: buyers.length, sellers: sellers.length, sentiment, reportDate: holdings[0]?.reportDate };
}

// ── CONGRESSIONAL TRADING ──
async function getCongressional(ticker) {
  // Finnhub has congressional trading on their API
  const d = await ff(`https://finnhub.io/api/v1/stock/congressional-trading?symbol=${ticker}&token=${FINNHUB_KEY}`);
  if (!d || !d.data || !d.data.length) return null;

  const trades = d.data.slice(0, 20).map(t => ({
    name:          t.name,
    chamber:       t.chamber,
    transaction:   t.transaction,
    amount:        t.amount,
    transactionDate: t.transactionDate,
    filingDate:    t.filingDate,
    party:         t.party || null,
  }));

  const buys  = trades.filter(t => t.transaction && t.transaction.toLowerCase().includes('purchase'));
  const sells = trades.filter(t => t.transaction && t.transaction.toLowerCase().includes('sale'));
  const recentDate = trades[0]?.transactionDate;
  const sentiment  = buys.length > sells.length ? 'Bullish' : sells.length > buys.length ? 'Bearish' : 'Mixed';

  return { trades, totalTrades: trades.length, buys: buys.length, sells: sells.length, sentiment, recentDate };
}

// ── DARK POOL / SHORT SALE VOLUME ──
async function getDarkPool(ticker) {
  // Finnhub: /stock/tick gives trade-level data on premium
  // Use /stock/splits and /stock/nbbo as proxies, or FINRA short volume
  // Best free approach: Finnhub /stock/nbbo for off-exchange indication
  // Actually use: /stock/earnings-quality as institutional signal proxy
  // Real dark pool: use FINRA off-exchange summary via the edge runtime
  try {
    const ctrl = new AbortController();
    // Try FINRA short sale volume API (different from threshold list)
    // https://finra-markets.morningstar.com/MarketData/EquityOptions/detail.jsp
    // Use the FINRA short volume data which IS accessible
    const dates = [];
    const now = new Date();
    for (let i = 1; i <= 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
      }
    }

    // FINRA short volume data - daily file
    for (const date of dates.slice(0, 3)) {
      const r = await fetch(`https://www.finra.org/sites/default/files/short-sale-volume-files/CNMSshvol${date}.txt`, {
        headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
      });
      if (!r.ok) continue;
      const txt = await r.text();
      const lines = txt.split('\n');
      const line  = lines.find(l => l.startsWith(ticker + '|'));
      if (!line) continue;
      const parts = line.split('|');
      // Format: Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
      const shortVol = parseInt(parts[1]) || 0;
      const totalVol = parseInt(parts[3]) || 0;
      const shortPct = totalVol > 0 ? (shortVol / totalVol * 100) : 0;
      return {
        date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
        shortVolume: shortVol,
        totalVolume: totalVol,
        shortSalePct: parseFloat(shortPct.toFixed(1)),
        // Off-exchange (dark pool) estimate: typically 30-40% of total
        // FINRA reports both lit and dark short volume combined
        sentiment: shortPct > 55 ? 'Heavy Short Selling' : shortPct > 45 ? 'Elevated Short Selling' : shortPct > 35 ? 'Normal' : 'Low Short Selling',
        source: 'FINRA Short Sale Volume',
      };
    }
    return null;
  } catch(e) { return null; }
}

// ── SHORT BORROW RATE ──
async function getBorrowRate(ticker) {
  // iborrowdesk publishes borrow rates - try via edge runtime
  try {
    const r = await fetch(`https://iborrowdesk.com/api/ticker/${ticker}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('not ok');
    const d = await r.json();
    return {
      rate:      d.rate,
      available: d.available,
      updated:   d.updated,
      source:    'iborrowdesk',
    };
  } catch(e) {
    // Fallback: derive from short interest data we already have
    return null;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  let ticker, feature;
  try {
    const u = new URL(req.url);
    ticker  = u.searchParams.get('ticker')?.toUpperCase();
    feature = u.searchParams.get('feature') || 'all';
  } catch(e) {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: cors });
  }

  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: cors });

  try {
    let result = {};

    if (feature === 'all') {
      const [options, inst13f, congress, darkpool, borrow] = await Promise.all([
        getOptions(ticker),
        get13F(ticker),
        getCongressional(ticker),
        getDarkPool(ticker),
        getBorrowRate(ticker),
      ]);
      result = { options, institutional: inst13f, congressional: congress, darkpool, borrow };
    } else if (feature === 'options')       result = await getOptions(ticker);
    else if (feature === 'institutional')   result = await get13F(ticker);
    else if (feature === 'congressional')   result = await getCongressional(ticker);
    else if (feature === 'darkpool')        result = await getDarkPool(ticker);
    else if (feature === 'borrow')          result = await getBorrowRate(ticker);

    return new Response(JSON.stringify({ ticker, feature, ...result }), {
      headers: { ...cors, 'Cache-Control': 'public, max-age=1800' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
