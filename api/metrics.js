export const config = { runtime: 'edge' };

const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';
const CORS = { 'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store' };

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

function fmtNum(n) {
  if(!n||isNaN(n)) return null;
  n = parseFloat(n);
  if(n>=1e12) return '$'+(n/1e12).toFixed(2)+'T';
  if(n>=1e9)  return '$'+(n/1e9).toFixed(2)+'B';
  if(n>=1e6)  return '$'+(n/1e6).toFixed(1)+'M';
  if(n>=1e3)  return (n/1e3).toFixed(0)+'K';
  return n.toLocaleString();
}

function fmtShares(n) {
  if(!n||isNaN(n)) return null;
  n = parseFloat(n);
  if(n>=1e9) return (n/1e9).toFixed(2)+'B';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  return n.toFixed(0);
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const ticker = (searchParams.get('ticker')||'').toUpperCase();
  if(!ticker) return new Response(JSON.stringify({error:'No ticker'}),{status:400,headers:CORS});

  // Fetch from multiple sources in parallel
  const [finnMetric, finnProfile, polySnap, polyDetails] = await Promise.all([
    sf(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`),
    sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`),
    POLYGON ? sf(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON}`) : Promise.resolve(null),
    POLYGON ? sf(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON}`) : Promise.resolve(null),
  ]);

  const m = finnMetric?.metric || {};
  const p = finnProfile || {};
  const pt = polySnap?.ticker || {};
  const pd = polyDetails?.results || {};

  // Build comprehensive metrics object
  const result = {
    // Price & Range
    week52High:   m['52WeekHigh']     || pd.market_cap ? null : null,
    week52Low:    m['52WeekLow']      || null,
    week52HighRaw: m['52WeekHigh']    || null,
    week52LowRaw:  m['52WeekLow']     || null,

    // Share structure
    sharesOutRaw:  m.shareOutstanding  ? m.shareOutstanding * 1e6  : (pd.share_class_shares_outstanding || null),
    floatRaw:      m.float             ? m.float * 1e6             : (pd.weighted_shares_outstanding   || null),

    // Volume
    avgVol10Raw:   m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume']*1e6 : null,
    avgVol3MRaw:   m['3MonthADTV']               ? m['3MonthADTV']*1e6               : null,
    todayVol:      pt.day?.v   || pt.prevDay?.v  || null,
    todayVWAP:     pt.day?.vw  || pt.prevDay?.vw || null,

    // Short interest
    shortRatio:    m.shortRatio        || null,
    shortInterest: m['shortInterest']  || null,
    shortPct:      m['shortPercent']   || null,

    // Fundamentals
    pe:            m.peBasicExclExtraTTM        || null,
    eps:           m.epsBasicExclExtraAnnual    || null,
    revGrowth:     m.revenueGrowthTTMYoy        ? (m.revenueGrowthTTMYoy*100).toFixed(1) : null,
    netMargin:     m.netProfitMarginAnnual      || null,
    roe:           m.roeTTM                     || null,
    beta:          m.beta                       || null,
    marketCap:     p.marketCapitalization       ? p.marketCapitalization * 1e6 : null,

    // Formatted strings for display
    week52:        (m['52WeekHigh'] && m['52WeekLow']) ? '$'+m['52WeekLow'].toFixed(2)+' — $'+m['52WeekHigh'].toFixed(2) : null,
    sharesOut:     fmtShares(m.shareOutstanding ? m.shareOutstanding*1e6 : pd.share_class_shares_outstanding),
    float:         fmtShares(m.float ? m.float*1e6 : pd.weighted_shares_outstanding),
    avgVol:        fmtShares(m['3MonthADTV'] ? m['3MonthADTV']*1e6 : m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume']*1e6 : null),
    shortDisplay:  m['shortInterest'] ? (m['shortInterest']*100).toFixed(2)+'%' : (m.shortRatio ? m.shortRatio.toFixed(1)+'d DTC' : null),

    // Polygon extras
    polyVol:       pt.day?.v ? fmtShares(pt.day.v) : (pt.prevDay?.v ? fmtShares(pt.prevDay.v) : null),
    vwap:          pt.day?.vw ? '$'+pt.day.vw.toFixed(2) : (pt.prevDay?.vw ? '$'+pt.prevDay.vw.toFixed(2) : null),
  };

  return new Response(JSON.stringify(result), {headers:CORS});
}
