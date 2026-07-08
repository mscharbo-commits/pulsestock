export const config = { runtime: 'edge' };
const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    return {status: r.status, data: r.ok ? await r.json() : await r.text()};
  } catch(e){ return {error: e.message}; }
}

export default async function handler(req) {
  const now = Math.floor(Date.now()/1000);
  const from = now - 86400 * 60; // 60 days back

  const [finnSMA, finnRSI, polyRSI, polySMA, polyCandles] = await Promise.all([
    sf(`https://finnhub.io/api/v1/indicator?symbol=SPY&resolution=D&from=${from}&to=${now}&indicator=sma&timeperiod=20&token=${FINNHUB}`),
    sf(`https://finnhub.io/api/v1/indicator?symbol=QQQ&resolution=D&from=${from}&to=${now}&indicator=rsi&timeperiod=14&token=${FINNHUB}`),
    sf(`https://api.polygon.io/v1/indicators/rsi/SPY?timespan=day&window=14&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v1/indicators/sma/SPY?timespan=day&window=20&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/2024-01-01/${new Date().toISOString().split('T')[0]}?adjusted=true&sort=desc&limit=50&apiKey=${POLYGON}`),
  ]);

  return new Response(JSON.stringify({
    finnSMA: {status:finnSMA.status, keys: finnSMA.data ? Object.keys(finnSMA.data) : null, sample: JSON.stringify(finnSMA.data).slice(0,200)},
    finnRSI: {status:finnRSI.status, sample: JSON.stringify(finnRSI.data).slice(0,200)},
    polyRSI: {status:polyRSI.status, sample: JSON.stringify(polyRSI.data).slice(0,200)},
    polySMA: {status:polySMA.status, sample: JSON.stringify(polySMA.data).slice(0,200)},
    polyCandles: {status:polyCandles.status, count: polyCandles.data?.resultsCount, sample: JSON.stringify(polyCandles.data?.results?.slice(0,2)).slice(0,200)},
  }, null, 2), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}
