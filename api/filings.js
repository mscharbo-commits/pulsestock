export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify([]), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const headers = { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'application/json' };

    // Step 1: Get CIK
    const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers });
    let cik = null, companyName = null;
    if (cikRes.ok) {
      const cikData = await cikRes.json();
      const match = Object.values(cikData).find(e => e.ticker && e.ticker.toUpperCase() === ticker.toUpperCase());
      if (match) { cik = String(match.cik_str).padStart(10, '0'); companyName = match.title; }
    }

    if (!cik) return new Response(JSON.stringify({ error: 'Company not found in SEC database', ticker }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });

    // Step 2: Get filing list
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers });
    if (!subRes.ok) throw new Error('SEC submissions failed');
    const subData = await subRes.json();

    const recent = subData.filings?.recent || {};
    const filings = [];

    if (recent.form) {
      for (let i = 0; i < recent.form.length; i++) {
        const accNum = recent.accessionNumber?.[i]?.replace(/-/g, '') || '';
        const accFormatted = recent.accessionNumber?.[i] || '';
        filings.push({
          type: recent.form[i],
          date: recent.filingDate?.[i] || '',
          description: (function() {
            var doc = recent.primaryDocument?.[i] || '';
            var reportDate = recent.reportDate?.[i] || '';
            var formType = recent.form[i] || '';
            if(reportDate) return formType + ' — Period: ' + reportDate;
            return doc.replace(/[_-]/g,' ').replace(/\.htm.*$/,'') || formType;
          })(),
          accession: accFormatted,
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNum}/${recent.primaryDocument?.[i] || ''}`,
          indexUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${recent.form[i]}&dateb=&owner=include&count=10`,
          detailUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40&search_text=`,
        });
      }
    }

    // Categorize filings
    const annualReports = filings.filter(f => ['10-K', '10-KSB', '10-K405', '20-F', '40-F'].includes(f.type));
    const quarterlyReports = filings.filter(f => ['10-Q', '10-QSB'].includes(f.type));
    const currentReports = filings.filter(f => f.type === '8-K');
    const proxies = filings.filter(f => ['DEF 14A', 'PRE 14A', 'DEFR14A'].includes(f.type));
    const registrations = filings.filter(f => ['S-1', 'S-1/A', 'S-3', 'F-1', 'F-3'].includes(f.type));
    const insiderFilings = filings.filter(f => ['4', '3', '5', 'SC 13G', 'SC 13D'].includes(f.type));
    const other = filings.filter(f => !annualReports.includes(f) && !quarterlyReports.includes(f) && !currentReports.includes(f) && !proxies.includes(f) && !registrations.includes(f) && !insiderFilings.includes(f));

    return new Response(JSON.stringify({
      ticker: ticker.toUpperCase(),
      cik,
      companyName: companyName || subData.name,
      edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
      totalFilings: filings.length,
      categories: {
        annualReports: annualReports.slice(0, 30),
        quarterlyReports: quarterlyReports.slice(0, 30),
        currentReports: currentReports.slice(0, 40),
        proxies: proxies.slice(0, 20),
        registrations: registrations.slice(0, 20),
        insiderFilings: insiderFilings.slice(0, 30),
        other: other.slice(0, 30),
      },
      recentFilings: filings.slice(0, 30),
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
