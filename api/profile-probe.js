export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const results = {};
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Test 1: Yahoo Finance - get crumb first then fetch profile
  try {
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: hdrs });
    const crumb = await crumbRes.text();
    results['yahoo_crumb'] = { status: crumbRes.status, crumb: crumb.slice(0,20) };

    if(crumbRes.ok && crumb) {
      const profileRes = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`,
        { headers: { ...hdrs, 'Cookie': crumbRes.headers.get('set-cookie') || '' } }
      );
      const data = await profileRes.json();
      const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
      results['yahoo_profile'] = {
        status: profileRes.status,
        description: profile?.longBusinessSummary?.slice(0, 300) || 'none',
        sector: profile?.sector,
        industry: profile?.industry,
        employees: profile?.fullTimeEmployees,
        website: profile?.website,
        country: profile?.country,
      };
    }
  } catch(e) { results['yahoo_crumb'] = { error: e.message }; }

  // Test 2: Yahoo Finance v11 (newer endpoint)
  try {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=assetProfile,summaryProfile,financialData`,
      { headers: hdrs }
    );
    const d = await r.json();
    const p = d?.quoteSummary?.result?.[0]?.assetProfile;
    results['yahoo_v11'] = {
      status: r.status,
      description: p?.longBusinessSummary?.slice(0,200) || 'none',
      sector: p?.sector,
    };
  } catch(e) { results['yahoo_v11'] = { error: e.message }; }

  // Test 3: Yahoo Finance scrape - look for description in meta tags
  try {
    const r = await fetch(`https://finance.yahoo.com/quote/${ticker}/profile/`, { headers: hdrs });
    const html = await r.text();
    // Yahoo embeds data in window.App.__reactProps or similar
    const jsonMatch = html.match(/"longBusinessSummary":"([^"]{50,500})"/);
    const sectorMatch = html.match(/"sector":"([^"]+)"/);
    const industryMatch = html.match(/"industry":"([^"]+)"/);
    results['yahoo_scrape'] = {
      status: r.status,
      description: jsonMatch ? jsonMatch[1].slice(0,200) : 'not found in HTML',
      sector: sectorMatch ? sectorMatch[1] : 'not found',
      industry: industryMatch ? industryMatch[1] : 'not found',
    };
  } catch(e) { results['yahoo_scrape'] = { error: e.message }; }

  // Test 4: Google Finance scrape
  try {
    const r = await fetch(`https://www.google.com/finance/quote/${ticker}:NASDAQ`, { headers: hdrs });
    const html = await r.text();
    // Google Finance embeds description in specific divs
    const descMatch = html.match(/class="bLLb2d[^>]*>([^<]{100,1000})<\/span>/);
    const desc2 = html.match(/"description":"([^"]{50,500})"/);
    results['google_scrape'] = {
      status: r.status,
      description: descMatch ? descMatch[1].slice(0,200) : (desc2 ? desc2[1].slice(0,200) : 'not found'),
      htmlSize: html.length,
    };
  } catch(e) { results['google_scrape'] = { error: e.message }; }

  // Test 5: Finnhub basic profile (already have key)
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`);
    const d = await r.json();
    results['finnhub_profile'] = {
      status: r.status,
      name: d.name,
      industry: d.finnhubIndustry,
      country: d.country,
      description: d.description ? d.description.slice(0,200) : 'NO DESCRIPTION FIELD',
      hasDescription: !!d.description,
    };
  } catch(e) { results['finnhub_profile'] = { error: e.message }; }

  // Test 6: Alpha Vantage free overview
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=demo`);
    const d = await r.json();
    results['alphavantage'] = {
      status: r.status,
      description: d.Description?.slice(0,200) || d.Note || 'none',
      sector: d.Sector,
      industry: d.Industry,
      employees: d.FullTimeEmployees,
    };
  } catch(e) { results['alphavantage'] = { error: e.message }; }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
