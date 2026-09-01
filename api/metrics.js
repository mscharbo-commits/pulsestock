export const config = { runtime: 'edge' };

const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';
const CORS = { 'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store' };

async function sf(url, t=6000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

function fmtShares(n) {
  if(!n||isNaN(n)) return null;
  n = parseFloat(n);
  if(n>=1e9) return (n/1e9).toFixed(2)+'B';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(0)+'K';
  return n.toFixed(0);
}

function fmt2(n) { return n ? parseFloat(n).toFixed(2) : null; }
function fmt1(n) { return n ? parseFloat(n).toFixed(1) : null; }

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const ticker = (searchParams.get('ticker')||'').toUpperCase();
  if(!ticker) return new Response(JSON.stringify({error:'No ticker'}),{status:400,headers:CORS});

  // Fetch from all sources in parallel
  const [finnMetric, finnProfile, polySnap, polyTicker, polyFinancials] = await Promise.all([
    sf(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`),
    sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`),
    POLYGON ? sf(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON}`) : null,
    POLYGON ? sf(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON}`) : null,
    POLYGON ? sf(`https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=1&apiKey=${POLYGON}`) : null,
  ]);

  const m   = finnMetric?.metric   || {};
  const p   = finnProfile           || {};
  const pt  = polySnap?.ticker      || {};
  const pr  = polyTicker?.results   || {};
  const pf  = polyFinancials?.results?.[0]?.financials || {};
  const inc = pf.income_statement   || {};
  const bal = pf.balance_sheet      || {};
  const cf  = pf.cash_flow_statement|| {};

  // ── Shares & Float ──────────────────────────────────────────────────────────
  const sharesOutRaw =
    (m.shareOutstanding        ? m.shareOutstanding * 1e6  : null) ||
    pr.share_class_shares_outstanding || pr.weighted_shares_outstanding ||
    (p.shareOutstanding        ? p.shareOutstanding * 1e6  : null);

  const floatRaw = m.float ? m.float * 1e6 : null;

  // ── Volume ───────────────────────────────────────────────────────────────────
  const todayVol  = pt.day?.v   || pt.prevDay?.v  || null;
  const todayVWAP = pt.day?.vw  || pt.prevDay?.vw || null;
  const avgVolRaw =
    (m['3MonthADTV']                  ? m['3MonthADTV']*1e6                 : null) ||
    (m['10DayAverageTradingVolume']   ? m['10DayAverageTradingVolume']*1e6  : null);

  // ── 52-Week Range ────────────────────────────────────────────────────────────
  const w52h = m['52WeekHigh'] || pt.day?.h || pt.prevDay?.h || null;
  const w52l = m['52WeekLow']  || pt.day?.l || pt.prevDay?.l || null;

  // ── Fundamentals — Polygon financials first, Finnhub fallback ──────────────
  const revenue = inc.revenues?.value || inc.net_revenues?.value || null;
  const netIncome = inc.net_income_loss?.value || null;
  const netMargin = (revenue && netIncome) 
    ? ((netIncome / revenue) * 100).toFixed(1) 
    : (m.netProfitMarginAnnual ? fmt1(m.netProfitMarginAnnual) : null);

  const totalAssets  = bal.assets?.value || null;
  const totalEquity  = bal.equity?.value || null;
  const totalDebt    = bal.long_term_debt?.value || null;

  // P/E — Polygon snapshot has this
  const pe = pt.day?.c && pr.market_cap
    ? null  // calculate below
    : (m.peBasicExclExtraTTM ? fmt1(m.peBasicExclExtraTTM) : null);

  // Use Polygon market cap + EPS for P/E if available
  const eps = inc.basic_earnings_per_share?.value || inc.diluted_earnings_per_share?.value || null;
  const price = pt.day?.c || pt.prevDay?.c || null;
  const peCalc = (price && eps && eps > 0) ? (price / eps).toFixed(1) : null;

  const shortPct =
    (m['shortInterest']  ? (m['shortInterest']*100).toFixed(2)+'%' : null) ||
    (m.shortRatio        ? m.shortRatio.toFixed(1)+'d DTC'         : null);

  const result = {
    week52:       (w52h && w52l) ? '$'+parseFloat(w52l).toFixed(2)+' — $'+parseFloat(w52h).toFixed(2) : null,
    week52High:   w52h ? '$'+parseFloat(w52h).toFixed(2) : null,
    week52Low:    w52l ? '$'+parseFloat(w52l).toFixed(2) : null,
    sharesOut:    fmtShares(sharesOutRaw),
    float:        fmtShares(floatRaw),
    avgVol:       fmtShares(avgVolRaw),
    polyVol:      fmtShares(todayVol),
    vwap:         todayVWAP ? '$'+parseFloat(todayVWAP).toFixed(2) : null,
    shortDisplay: shortPct,
    // Fundamentals
    pe:           peCalc || pe,
    beta:         m.beta ? fmt2(m.beta) : null,
    netMargin:    netMargin ? netMargin+'%' : null,
    roe:          m.roeTTM ? fmt1(m.roeTTM)+'%' : (totalEquity && netIncome ? ((netIncome/totalEquity)*100).toFixed(1)+'%' : null),
    revenue:      revenue ? fmtShares(revenue) : null,
    totalDebt:    totalDebt ? fmtShares(totalDebt) : null,
    totalAssets:  totalAssets ? fmtShares(totalAssets) : null,
    // Raw for deep dive
    sharesOutRaw, floatRaw, avgVolRaw, todayVol, todayVWAP,
    week52HighRaw: w52h || null,
    week52LowRaw:  w52l || null,
  };

  return new Response(JSON.stringify(result), {headers:CORS});
}
