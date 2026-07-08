export const config = { runtime: 'edge' };
const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || '';

async function sf(url, t=6000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    const text = await r.text();
    return {status: r.status, body: text.slice(0,300)};
  } catch(e){ return {error: e.message}; }
}

export default async function handler(req) {
  const today = new Date().toISOString().split('T')[0];
  const past = '2025-01-01';

  const [polyRSI, polySMA20, polySMA50, polyEMA, polyMACD, finnIndicator, polyAggs] = await Promise.all([
    sf(`https://api.polygon.io/v1/indicators/rsi/SPY?timespan=day&window=14&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v1/indicators/sma/SPY?timespan=day&window=20&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v1/indicators/sma/QQQ?timespan=day&window=50&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v1/indicators/ema/IWM?timespan=day&window=200&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://api.polygon.io/v1/indicators/macd/SPY?timespan=day&short_window=12&long_window=26&signal_window=9&series_type=close&limit=3&apiKey=${POLYGON}`),
    sf(`https://finnhub.io/api/v1/indicator?symbol=SPY&resolution=D&from=1700000000&to=9999999999&indicator=rsi&timeperiod=14&token=${FINNHUB}`),
    sf(`https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${past}/${today}?adjusted=true&sort=desc&limit=3&apiKey=${POLYGON}`),
  ]);

  return new Response(JSON.stringify({polyRSI, polySMA20, polySMA50, polyEMA, polyMACD, finnIndicator, polyAggs}, null, 2),
    {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}
