export const config = { runtime: 'edge' };
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({}), { headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const searchRes = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(ticker) + '%22&forms=10-K,10-Q,8-K&dateRange=custom&startdt=2023-01-01&enddt=' + new Date().toISOString().split('T')[0], { headers: {'User-Agent':'PulseStock research@pulsestock.com'} });
    let filings = [], isFullyReporting = false, lastFilingDate = null, filingTypes = [], companyName = null;
    if (searchRes.ok) {
      const data = await searchRes.json();
      const hits = data?.hits?.hits || [];
      if (hits.length > 0) {
        isFullyReporting = true;
        filings = hits.slice(0,5).map(h => ({ type: h._source?.form_type||'', date: h._source?.file_date||'', description: h._source?.display_names?.[0]||'' }));
        lastFilingDate = filings[0]?.date;
        filingTypes = [...new Set(filings.map(f => f.type).filter(Boolean))];
        companyName = hits[0]?._source?.display_names?.[0] || ticker;
      }
    }
    return new Response(JSON.stringify({ ticker: ticker.toUpperCase(), companyName, isFullyReporting, lastFilingDate, filingTypes, filings, edgarUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK='+ticker+'&type=10-K&dateb=&owner=include&count=10' }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message, ticker }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
