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

function fmtShares(n) {
  if(!n||isNaN(n)) return null;
  n = parseFloat(n);
  if(n>=1e9) return (n/1e9).toFixed(2)+'B';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(0)+'K';
  return n.toFixed(0);
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const ticker = (searchParams.get('ticker')||'').toUpperCase();
  if(!ticker) return new Response(JSON.stringify({error:'No ticker'}),{status:400,headers:CORS});

  const [finnMetric, finnProfile, polySnap, polyTicker] = await Promise.all([
    sf(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`),
    sf(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB}`),
    POLYGON ? sf(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON}`) : null,
    POLYGON ? sf(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON}`) : null,
  ]);

  const m  = finnMetric?.metric  || {};
  const p  = finnProfile          || {};
  const pt = polySnap?.ticker     || {};
  const pr = polyTicker?.results  || {};

  // Shares outstanding - try multiple sources
  const sharesOutRaw =
    (m.shareOutstanding       ? m.shareOutstanding * 1e6          : null) ||
    (pr.share_class_shares_outstanding                              || null) ||
    (pr.weighted_shares_outstanding                                 || null) ||
    (p.shareOutstanding       ? p.shareOutstanding * 1e6          : null);

  // Float - Finnhub float is in millions
  const floatRaw =
    (m.float                  ? m.float * 1e6                     : null);

  // Short interest
  const shortPct =
    (m['shortInterest']       ? (m['shortInterest']*100).toFixed(2)+'%' : null) ||
    (m.shortRatio             ? m.shortRatio.toFixed(1)+'d DTC'         : null);

  // Volume - use prevDay when market closed
  const todayVol   = pt.day?.v     || pt.prevDay?.v   || null;
  const todayVWAP  = pt.day?.vw    || pt.prevDay?.vw  || null;

  // Avg volume
  const avgVolRaw  =
    (m['3MonthADTV']          ? m['3MonthADTV']*1e6               : null) ||
    (m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume']*1e6 : null);

  const result = {
    // Formatted for display
    week52:       (m['52WeekHigh'] && m['52WeekLow']) ? '$'+parseFloat(m['52WeekLow']).toFixed(2)+' — $'+parseFloat(m['52WeekHigh']).toFixed(2) : null,
    week52High:   m['52WeekHigh'] ? '$'+parseFloat(m['52WeekHigh']).toFixed(2) : null,
    week52Low:    m['52WeekLow']  ? '$'+parseFloat(m['52WeekLow']).toFixed(2)  : null,
    sharesOut:    fmtShares(sharesOutRaw),
    float:        fmtShares(floatRaw),
    avgVol:       fmtShares(avgVolRaw),
    polyVol:      fmtShares(todayVol),
    vwap:         todayVWAP ? '$'+parseFloat(todayVWAP).toFixed(2) : null,
    shortDisplay: shortPct,
    // Fundamentals
    pe:           m.peBasicExclExtraTTM   ? parseFloat(m.peBasicExclExtraTTM).toFixed(1)   : null,
    beta:         m.beta                  ? parseFloat(m.beta).toFixed(2)                  : null,
    netMargin:    m.netProfitMarginAnnual ? parseFloat(m.netProfitMarginAnnual).toFixed(1) : null,
    roe:          m.roeTTM                ? parseFloat(m.roeTTM).toFixed(1)                : null,
    // Raw numbers for deep dive
    sharesOutRaw, floatRaw, avgVolRaw, todayVol, todayVWAP,
    week52HighRaw: m['52WeekHigh'] || null,
    week52LowRaw:  m['52WeekLow']  || null,
  };

  return new Response(JSON.stringify(result), {headers:CORS});
}
