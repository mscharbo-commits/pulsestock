export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const tickerRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const tickers = await tickerRes.json();
    const entry = Object.values(tickers).find(e => e.ticker === 'AAPL');
    const cik = String(entry.cik_str).padStart(10,'0');

    const filingsRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const filings = await filingsRes.json();
    const recent = filings.filings?.recent;
    const idx10k = recent?.form?.findIndex(f => f === '10-K');
    const accession = recent?.accessionNumber?.[idx10k]?.replace(/-/g,'');
    const primaryDoc = recent?.primaryDocument?.[idx10k];
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accession}/${primaryDoc}`;

    const docRes = await fetch(docUrl, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
    const html = await docRes.text();

    const item1idx = html.search(/item\s*1[\.\s]*business/i);
    const section = html.substring(item1idx, item1idx + 3000);

    return new Response(JSON.stringify({
      cik, accession, primaryDoc, docUrl,
      htmlLength: html.length,
      item1idx,
      sectionPreview: section.substring(0, 1000)
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
