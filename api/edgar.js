export const config = { runtime: 'edge' };
export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({}), { headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const headers = { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'application/json' };
    const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers });
    let cik = null, companyName = null;
    if (cikRes.ok) {
      const cikData = await cikRes.json();
      const match = Object.values(cikData).find(e => e.ticker && e.ticker.toUpperCase() === ticker.toUpperCase());
      if (match) { cik = String(match.cik_str).padStart(10, '0'); companyName = match.title; }
    }
    let filings = [], filingTypes = [], lastFilingDate = null, isFullyReporting = false;
    let revenue = null, netIncome = null, assets = null, cash = null;
    if (cik) {
      const subRes = await fetch('https://data.sec.gov/submissions/CIK' + cik + '.json', { headers });
      if (subRes.ok) {
        const subData = await subRes.json();
        companyName = companyName || subData.name;
        const recent = subData.filings?.recent;
        if (recent?.form) {
          for (let i = 0; i < Math.min(recent.form.length, 10); i++) filings.push({ type: recent.form[i], date: recent.filingDate[i], accession: recent.accessionNumber[i] });
          isFullyReporting = filings.some(f => ['10-K','10-Q','10-KSB','10-QSB'].includes(f.type));
          lastFilingDate = filings[0]?.date;
          filingTypes = [...new Set(filings.map(f => f.type))].slice(0, 6);
        }
        try {
          const factsRes = await fetch('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', { headers });
          if (factsRes.ok) {
            const facts = await factsRes.json();
            const g = facts.facts?.['us-gaap'] || {};
            const latest = (key) => { const u = g[key]?.units?.USD; if(!u) return null; const v = u.filter(x => x.form==='10-K'||x.form==='10-Q').sort((a,b) => b.end>a.end?1:-1); return v[0]?.val??null; };
            revenue = latest('Revenues') ?? latest('RevenueFromContractWithCustomerExcludingAssessedTax') ?? latest('SalesRevenueNet');
            netIncome = latest('NetIncomeLoss');
            assets = latest('Assets');
            cash = latest('CashAndCashEquivalentsAtCarryingValue') ?? latest('Cash');
          }
        } catch(e) {}
      }
    }
    const fmt = (v) => { if(v===null||v===undefined) return null; const a=Math.abs(v); return a>=1e9?(v/1e9).toFixed(2)+'B':a>=1e6?(v/1e6).toFixed(2)+'M':a>=1e3?(v/1e3).toFixed(1)+'K':v.toFixed(0); };
    return new Response(JSON.stringify({ ticker: ticker.toUpperCase(), cik, companyName, isFullyReporting, lastFilingDate, filingTypes, filings: filings.slice(0,5), financials: { revenue: fmt(revenue), netIncome: fmt(netIncome), assets: fmt(assets), cash: fmt(cash) }, edgarUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK='+(cik||ticker)+'&type=10-K&dateb=&owner=include&count=10' }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
