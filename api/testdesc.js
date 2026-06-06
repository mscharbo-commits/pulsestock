export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const base = 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079';
    const docRes = await fetch(`${base}/aapl-20250927.htm`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const html = await docRes.text();
    
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Collect all match positions
    const matches = [];
    const pattern = /Item\s+1[\.\s]+Business/gi;
    let m;
    while ((m = pattern.exec(text)) !== null) matches.push(m.index);

    // Use the LAST match - always the real content, first is always TOC
    const realIdx = matches[matches.length - 1];
    
    // Find end: next "Item 1A" after our start
    const endIdx = text.indexOf('Item 1A', realIdx + 30);
    const rawSection = text.substring(realIdx, endIdx > 0 ? endIdx : realIdx + 5000);
    
    // Strip the header "Item 1. Business" from start
    const cleaned = rawSection
      .replace(/^Item\s+1[\.\s]+Business\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);

    return new Response(JSON.stringify({
      totalMatches: matches.length,
      matchPositions: matches,
      realIdx,
      description: cleaned,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
