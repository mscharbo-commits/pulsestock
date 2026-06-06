export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const base = 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079';
    
    // Fetch the main XBRL doc and strip tags to find Item 1
    const docRes = await fetch(`${base}/aapl-20250927.htm`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const html = await docRes.text();
    
    // Strip all HTML tags to get plain text
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Find Item 1. Business
    const idx = text.search(/Item\s+1[\.\s]+Business/i);
    const idx2 = text.search(/Item\s+1A[\.\s]+Risk/i); // ends before Item 1A

    const businessSection = idx >= 0 
      ? text.substring(idx, idx2 > idx ? Math.min(idx + 5000, idx2) : idx + 5000)
      : 'NOT FOUND';

    return new Response(JSON.stringify({
      textLength: text.length,
      item1idx: idx,
      item1Aix: idx2,
      businessSection: businessSection.substring(0, 2000),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
