export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const results = {};

  // Test 1: Get crumb
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': ua, 'Accept': '*/*' }
    });
    const crumb = await r.text();
    const cookie = r.headers.get('set-cookie');
    results.crumb = { status: r.status, crumb: crumb.slice(0,30), cookieLen: cookie?.length || 0 };

    // Test 2: Use crumb with cookie
    if (r.ok && crumb.trim()) {
      const r2 = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile&crumb=${encodeURIComponent(crumb.trim())}`,
        { headers: { 'User-Agent': ua, 'Accept': 'application/json', 'Cookie': cookie || '' } }
      );
      const d2 = await r2.json();
      results.with_cookie = {
        status: r2.status,
        error: d2?.quoteSummary?.error || null,
        hasProfile: !!d2?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary,
        preview: d2?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary?.slice(0,80) || JSON.stringify(d2).slice(0,100)
      };

      // Test 3: Without cookie
      const r3 = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile&crumb=${encodeURIComponent(crumb.trim())}`,
        { headers: { 'User-Agent': ua, 'Accept': 'application/json' } }
      );
      const d3 = await r3.json();
      results.without_cookie = {
        status: r3.status,
        error: d3?.quoteSummary?.error || null,
        hasProfile: !!d3?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary,
      };
    }
  } catch(e) { results.crumb = { error: e.message }; }

  // Test 4: Yahoo page scrape for description
  try {
    const r = await fetch(`https://finance.yahoo.com/quote/${ticker}/profile/`, {
      headers: { 'User-Agent': ua, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    const html = await r.text();
    const match = html.match(/"longBusinessSummary":"((?:[^"\\]|\\.)*)"/);
    const appMatch = html.match(/longBusinessSummary['":\s]+"([^"]{50,}?)"/);
    results.page_scrape = {
      status: r.status,
      htmlSize: html.length,
      regexMatch: match ? match[1].slice(0,100) : 'no match',
      appMatch: appMatch ? appMatch[1].slice(0,100) : 'no match',
      // Check if it's a consent page
      isConsent: html.includes('consent') || html.includes('GDPR'),
    };
  } catch(e) { results.page_scrape = { error: e.message }; }

  // Test 5: Yahoo Finance v8 (older endpoint, sometimes no crumb needed)
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?includePrePost=false&interval=1d&range=1d`,
      { headers: { 'User-Agent': ua } }
    );
    results.v8_chart = { status: r.status };
  } catch(e) { results.v8_chart = { error: e.message }; }

  // Test 6: Try different Yahoo endpoint for profile
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=assetProfile`,
      { headers: { 'User-Agent': ua, 'Accept': 'application/json' } }
    );
    const d = await r.json();
    results.v11_no_crumb = {
      status: r.status,
      error: d?.quoteSummary?.error?.code || null,
      hasData: !!d?.quoteSummary?.result?.[0]?.assetProfile
    };
  } catch(e) { results.v11_no_crumb = { error: e.message }; }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
