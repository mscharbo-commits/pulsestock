export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  const results = {};

  await Promise.all([

    // 1. Wikipedia - company article (not ticker disambiguation)
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/Apple_Inc`, { headers: { 'User-Agent': 'PulseStock/1.0' } })
      .then(r => r.json()).then(d => { results.wikipedia_direct = { status: 200, extract: d.extract?.slice(0,200), type: d.type }; })
      .catch(e => { results.wikipedia_direct = { error: e.message }; }),

    // 2. Wikipedia search by ticker -> company name
    fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${ticker}+corporation+company&format=json&srlimit=3`, { headers: { 'User-Agent': 'PulseStock/1.0' } })
      .then(r => r.json()).then(d => { results.wikipedia_search = { hits: d.query?.search?.slice(0,3).map(s=>({title:s.title,snippet:s.snippet?.replace(/<[^>]+>/g,'').slice(0,80)})) }; })
      .catch(e => { results.wikipedia_search = { error: e.message }; }),

    // 3. OpenFIGI - free, maps ticker to company info
    fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ 'idType': 'TICKER', 'idValue': ticker, 'exchCode': 'US' }])
    }).then(r => r.json()).then(d => { results.openfigi = { status: 200, data: JSON.stringify(d).slice(0,200) }; })
      .catch(e => { results.openfigi = { error: e.message }; }),

    // 4. Polygon.io company details (free tier has basic info)
    fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=demo`)
      .then(r => r.json()).then(d => { results.polygon_free = { status: 200, name: d.results?.name, description: d.results?.description?.slice(0,150), sic_description: d.results?.sic_description }; })
      .catch(e => { results.polygon_free = { error: e.message }; }),

    // 5. IEX Cloud free (public/open) - company info
    fetch(`https://api.iex.cloud/v1/data/core/COMPANY/${ticker}?token=pk_test_placeholder`)
      .then(r => r.json()).then(d => { results.iex = { data: JSON.stringify(d).slice(0,150) }; })
      .catch(e => { results.iex = { error: e.message }; }),

    // 6. SEC EDGAR company search - gets official company name + SIC
    fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=10-K&dateRange=custom&startdt=2024-01-01&hits.hits._source.entity_name=true&hits.hits._source.file_date=true`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    }).then(r => r.json()).then(d => { results.sec_search = { total: d.hits?.total?.value, first: d.hits?.hits?.[0]?._source?.entity_name }; })
      .catch(e => { results.sec_search = { error: e.message }; }),

    // 7. Finnhub - check all profile fields we get
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`)
      .then(r => r.json()).then(d => { results.finnhub_all_fields = Object.keys(d); })
      .catch(e => { results.finnhub_all_fields = { error: e.message }; }),

    // 8. Clearbit Autocomplete (free, no key needed)
    fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${ticker}`)
      .then(r => r.json()).then(d => { results.clearbit_auto = { data: JSON.stringify(d).slice(0,200) }; })
      .catch(e => { results.clearbit_auto = { error: e.message }; }),

    // 9. Alpha Vantage OVERVIEW - free 25 req/day
    fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=MDTO4RDRQK8BOEDT`)
      .then(r => r.json()).then(d => { results.alpha_vantage = { description: d.Description?.slice(0,200), sector: d.Sector, industry: d.Industry, employees: d.FullTimeEmployees, note: d.Note?.slice(0,100) }; })
      .catch(e => { results.alpha_vantage = { error: e.message }; }),

  ]);

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
