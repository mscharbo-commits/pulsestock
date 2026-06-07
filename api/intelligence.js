export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const results = {};

  const tests = [
    // FINRA ATS weekly data - dark pool venue breakdown
    ['finra_ats_weekly', 'https://api.finra.org/data/group/OTCMarket/name/atsWeeklySummary?limit=5'],
    // FINRA off-exchange summary with dollar volume
    ['finra_otc_summary', `https://api.finra.org/data/group/otcMarket/name/weeklySummary?compareFilters=[{"compareType":"EQUAL","fieldName":"issueSymbolIdentifier","fieldValue":"${ticker}"}]&limit=4`],
    // Unusual Whales public dark pool endpoint
    ['unusual_whales_dp', `https://phx.unusualwhales.com/api/darkpool/ticker/${ticker}`],
    ['unusual_whales_flow', `https://phx.unusualwhales.com/api/darkpool/flow?ticker=${ticker}`],
    // Stockanalysis dark pool
    ['stockanalysis', `https://api.stockanalysis.com/stocks/${ticker.toLowerCase()}/darkpool/`],
    // Barchart dark pool
    ['barchart_dp', `https://www.barchart.com/proxies/core-api/v1/quotes/get?symbols=${ticker}&fields=darkpoolVolume,darkpoolPct`],
    // Market Chameleon
    ['mktchameleon', `https://marketchameleon.com/api/darkpool/?ticker=${ticker}&period=1m`],
    // FINRA full short vol with dollar calculation
    ['finra_shortvol_latest', 'https://cdn.finra.org/equity/regsho/daily/CNMSshvol20260605.txt'],
  ];

  await Promise.all(tests.map(async ([name, url]) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Accept': 'application/json,text/plain,*/*' }
      });
      clearTimeout(t);
      const text = await r.text();
      results[name] = { status: r.status, preview: text.slice(0, 120) };
    } catch(e) { results[name] = { error: e.message.slice(0, 50) }; }
  }));

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
