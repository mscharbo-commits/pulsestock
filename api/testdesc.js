export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const cik = '0000320193';
    const accession = '000032019325000079';

    // Try the filing index to find a non-XBRL version
    const idxUrl = `https://www.sec.gov/Archives/edgar/data/320193/${accession}/0000320193-25-000079-index.htm`;
    const idxRes = await fetch(idxUrl, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
    const idxHtml = await idxRes.text();

    // Find all document links in the index
    const docLinks = [...idxHtml.matchAll(/href="([^"]*\.htm)"/gi)].map(m => m[1]).slice(0,10);

    // Also try the R2.htm viewer which SEC uses for human-readable 10-K
    const r2Url = `https://www.sec.gov/Archives/edgar/data/320193/${accession}/R2.htm`;
    const r2Res = await fetch(r2Url, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
    
    // Try fetching the filing viewer page which has clean text
    const viewerUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K&dateb=&owner=include&count=1&search_text=`;
    
    return new Response(JSON.stringify({
      idxStatus: idxRes.status,
      docLinks,
      r2Status: r2Res.status,
      idxPreview: idxHtml.substring(0, 2000),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
