export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DATA_REPO = 'mscharbo-commits/pulsestock-data';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
    if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const today = new Date().toISOString().split('T')[0];

    // Read all batch files in parallel to find this ticker
    const batchFetches = [];
    for (let b = 0; b < 100; b++) {
      batchFetches.push(
        fetch(`https://api.github.com/repos/${DATA_REPO}/contents/batch_${b}.json`, {
          headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'PulseStock' }
        })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d?.content) return null;
          const data = JSON.parse(atob(d.content.replace(/\n/g, '')));
          return data?.picks?.find(p => p.sym === ticker && p.date === today) || null;
        })
        .catch(() => null)
      );
    }

    const results = await Promise.all(batchFetches);
    const pick = results.find(r => r !== null);

    if (!pick) {
      return new Response(JSON.stringify({ found: false, ticker }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // Map picks format to quote page format
    // BUY → BUY, WATCH → HOLD, AVOID → SELL
    const ratingMap = { BUY: 'BUY', WATCH: 'HOLD', AVOID: 'SELL' };
    const confMap = v => v >= 75 ? 'High' : v >= 60 ? 'Medium' : 'Low';

    return new Response(JSON.stringify({
      found: true,
      ticker,
      date: pick.date,
      // Native picks format
      rating: pick.rating,
      confidence: pick.confidence,
      reason: pick.reason,
      target: pick.target,
      technicalSignal: pick.technicalSignal,
      fundamentalScore: pick.fundamentalScore,
      macroAlignment: pick.macroAlignment,
      // Quote page compatible format
      verdict: ratingMap[pick.rating] || 'HOLD',
      verdictConfidence: confMap(pick.confidence),
      // Change tracking
      dailyChange: pick.dailyChange,
      dailyChangePts: pick.dailyChangePts,
      prevRating: pick.prevRating,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1800' }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}
