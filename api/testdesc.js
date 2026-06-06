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

    // Find ALL occurrences of "Item 1. Business"
    const matches = [];
    let searchFrom = 0;
    const pattern = /Item\s+1[\.\s]+Business/gi;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      matches.push({ idx: m.index, preview: text.substring(m.index, m.index + 200) });
      if (matches.length >= 5) break;
    }

    // The TOC match is short (just "Item 1. Business 1"), 
    // the real section has actual paragraph text after it
    // Find the match where substantial text follows
    const realMatch = matches.find(match => {
      const after = text.substring(match.idx + 20, match.idx + 300);
      return after.trim().length > 100 && !/^\s*\d+\s*Item/.test(after);
    });

    // Also try finding the next Item 1A after the real match
    let businessText = '';
    if (realMatch) {
      const nextItem = text.indexOf('Item 1A', realMatch.idx + 50);
      businessText = text.substring(realMatch.idx, nextItem > 0 ? nextItem : realMatch.idx + 4000);
    }

    return new Response(JSON.stringify({
      totalMatches: matches.length,
      allMatches: matches,
      realMatchIdx: realMatch?.idx,
      businessText: businessText.substring(0, 2000),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
