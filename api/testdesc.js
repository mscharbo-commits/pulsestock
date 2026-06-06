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

    // Find all Item 1 Business occurrences, skip TOC (which has page numbers after it)
    const matches = [];
    const pattern = /Item\s+1[\.\s]+Business/gi;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      matches.push(m.index);
    }

    // TOC entry has digits right after (page numbers), real section has actual prose
    const realIdx = matches.find(idx => {
      const after = text.substring(idx + 20, idx + 100);
      // TOC: "Item 1. Business 1 Item 1A..." — has digit then "Item"
      // Real: "Item 1. Business Company Background..." — has words
      return !/^\s*\d+\s*Item/.test(after) && !/^\s*\d+\s*$/.test(after.trim().substring(0,5));
    }) || matches[matches.length - 1]; // fallback to last match

    // Extract from real Item 1 to Item 1A
    const endIdx = text.indexOf('Item 1A', realIdx + 50);
    const rawSection = text.substring(realIdx, endIdx > 0 ? endIdx : realIdx + 5000);

    // Clean up: remove "Item 1. Business" header, clean whitespace
    const cleaned = rawSection
      .replace(/^Item\s+1[\.\s]+Business\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Take first 800 chars as the description — enough for a good summary
    const description = cleaned.substring(0, 800);

    return new Response(JSON.stringify({
      realIdx,
      descriptionLength: cleaned.length,
      description,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
