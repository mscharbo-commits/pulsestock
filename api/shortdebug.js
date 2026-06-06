export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    // Try fetching the FTD data page to find actual file URLs
    const res = await fetch('https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data', {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'text/html' }
    });
    const html = await res.text();
    // Find all zip file links
    const matches = [...html.matchAll(/href="([^"]*cnsfails[^"]*\.zip)"/gi)];
    const zips = matches.map(m => m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1]).slice(0,4);
    
    // Now try fetching one of the txt files directly (SEC also publishes .txt versions)
    // Try the most recent period
    const now = new Date();
    const yr = now.getFullYear();
    const mo = String(now.getMonth()+1).padStart(2,'0');
    const prevMo = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYr = now.getMonth() === 0 ? yr-1 : yr;
    const prevMoStr = String(prevMo).padStart(2,'0');
    
    // Try direct txt files (some periods have txt not just zip)
    const txtUrls = [
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${yr}${mo}b.zip`,
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${yr}${mo}a.zip`,
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${prevYr}${prevMoStr}b.zip`,
    ];
    
    // Check if any txt files exist
    const checks = await Promise.all(txtUrls.slice(0,2).map(async u => {
      const r = await fetch(u, { method: 'HEAD', headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
      return { url: u, status: r.status };
    }));
    
    return new Response(JSON.stringify({ 
      pageStatus: res.status,
      pageLength: html.length,
      zipLinks: zips,
      fileChecks: checks,
      htmlPreview: html.substring(html.indexOf('cnsfails') > 0 ? html.indexOf('cnsfails')-100 : 0, html.indexOf('cnsfails')+500)
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
