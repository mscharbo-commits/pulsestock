export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function ff(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) return { _status: r.status, _text: await r.text().catch(()=>'') };
    return await r.json();
  } catch(e) { return { _error: e.message }; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const u = new URL(req.url);
  const ticker = u.searchParams.get('ticker')?.toUpperCase() || 'AAPL';

  // Test every potentially useful Finnhub free endpoint + alternatives
  const tests = await Promise.all([
    // Finnhub options
    ff(`https://finnhub.io/api/v1/stock/option-chain?symbol=${ticker}&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_options', d._status || (d.data ? `${d.data.length} expiries` : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub 13F
    ff(`https://finnhub.io/api/v1/fund-ownership?symbol=${ticker}&limit=5&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_13f', d._status || (d.ownership ? `${d.ownership.length} holders` : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub congressional
    ff(`https://finnhub.io/api/v1/stock/congressional-trading?symbol=${ticker}&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_congressional', d._status || (d.data ? `${d.data.length} trades` : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub earnings quality
    ff(`https://finnhub.io/api/v1/stock/earnings-quality?symbol=${ticker}&freq=annual&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_earnings_quality', d._status || (Array.isArray(d) ? `${d.length} records` : 'empty/obj'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub social sentiment
    ff(`https://finnhub.io/api/v1/stock/social-sentiment?symbol=${ticker}&from=2026-05-01&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_sentiment', d._status || (d.reddit||d.twitter ? 'has data' : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub supply chain
    ff(`https://finnhub.io/api/v1/stock/supply-chain?symbol=${ticker}&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_supply_chain', d._status || (d.data ? `${d.data.length} items` : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub USPTO patents
    ff(`https://finnhub.io/api/v1/stock/uspto-patent?symbol=${ticker}&from=2025-01-01&to=2026-06-01&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_patents', d._status || (d.data ? `${d.data.length} patents` : 'empty'), d._error||d._text?.slice(0,80)||'']),
    // Finnhub similarity index (peers)
    ff(`https://finnhub.io/api/v1/stock/market-holiday?exchange=US&token=${FINNHUB_KEY}`)
      .then(d => ['finnhub_market_holiday', d._status || (Array.isArray(d) ? `${d.length}` : 'obj'), '']),
    // SEC EDGAR - institutional 13F via data.sec.gov
    ff('https://data.sec.gov/submissions/CIK0000320193.json', { headers: {'User-Agent':'PulseStock research@pulsestock.com'}})
      .then(d => ['sec_edgar_submissions', d._status || (d.filings ? 'has filings' : 'empty'), d._error||'']),
    // iborrowdesk full response
    ff(`https://iborrowdesk.com/api/ticker/${ticker}`)
      .then(d => ['iborrowdesk', d._status || JSON.stringify(d).slice(0,100), d._error||'']),
    // Quiver congressional with auth header
    ff('https://api.quiverquant.com/beta/live/congresstrading', { headers: {'Accept':'application/json','X-CSRFToken':'quiver'}})
      .then(d => ['quiver_congress', d._status || (Array.isArray(d) ? `${d.length} trades` : 'obj'), d._error||d._text?.slice(0,80)||'']),
    // FINRA short sale volume
    ff('https://www.finra.org/sites/default/files/short-sale-volume-files/CNMSshvol20260605.txt')
      .then(d => ['finra_shortvol', d._status || (typeof d === 'string' ? 'text data' : 'json'), d._error||'']),
  ]);

  const result = {};
  for (const [name, status, detail] of tests) {
    result[name] = { status, detail };
  }

  return new Response(JSON.stringify(result, null, 2), { headers: cors });
}
