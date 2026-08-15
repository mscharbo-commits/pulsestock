// /api/analysis-cache.js
// Smart cache for stock deep dive — event-based invalidation, not time-based
// Stores: generated time, price at generation, headlines at generation, analysis text
// Invalidates when: price moves >=2%, Haiku says news is material, earnings within 48h, >6h old

export const config = { runtime: 'edge' };

const FINNHUB    = process.env.FINNHUB_KEY;
const ANTHROPIC  = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO       = 'mscharbo-commits/pulsestock';
const CORS       = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const PRICE_MOVE_THRESHOLD = 0.02;  // 2% move = invalidate
const MAX_AGE_MS           = 6 * 60 * 60 * 1000; // 6 hour hard ceiling
const EARNINGS_WINDOW_MS   = 48 * 60 * 60 * 1000; // 48h earnings window

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController(), id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(id);
    if(!r.ok) return null; return await r.json();
  } catch(e) { return null; }
}

// Read cache file from GitHub repo
async function readCache(ticker) {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/contents/cache/${ticker.toUpperCase()}.json`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'PulseStock' } }
    );
    if(!r.ok) return null;
    const data = await r.json();
    const content = atob(data.content.replace(/\n/g,''));
    return { data: JSON.parse(content), sha: data.sha };
  } catch(e) { return null; }
}

// Write cache file to GitHub repo
async function writeCache(ticker, cacheData, existingSha) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(cacheData))));
  const body = { message: `Cache ${ticker} analysis`, content };
  if(existingSha) body.sha = existingSha;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/contents/cache/${ticker.toUpperCase()}.json`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'PulseStock' },
        body: JSON.stringify(body)
      }
    );
    return r.ok;
  } catch(e) { return false; }
}

// Check if news headlines contain anything material
// Uses Haiku — costs ~$0.001 per check
async function isNewsMaterial(ticker, oldHeadlines, newHeadlines) {
  if(!ANTHROPIC || !newHeadlines?.length) return false;

  // Find headlines that weren't in the old set
  const oldSet = new Set(oldHeadlines || []);
  const fresh = newHeadlines.filter(h => !oldSet.has(h));
  if(!fresh.length) return false; // no new headlines at all

  // Ask Haiku if any fresh headline is material
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system: `You are a financial news filter. Determine if any headline represents a MATERIAL change to a company's business that would invalidate a stock analysis.

MATERIAL events (answer YES):
- Earnings report released or pre-announcement
- Guidance revision (raised or lowered)  
- CEO, CFO, or board member departure or appointment
- Merger, acquisition, spinoff, or buyout announced
- DOJ, SEC, or regulatory investigation announced
- FDA approval or rejection
- Major contract won or lost (>5% revenue impact)
- Dividend cut, suspension, or initiation
- Stock halt or trading suspension
- Bankruptcy or restructuring filing
- Analyst upgrade/downgrade with target change >15%

NOT MATERIAL (answer NO):
- Price target tweaks (<15% change)
- "Could benefit from..." or "might see..." speculation
- Recycled product rumors without sourcing
- Headlines with "reportedly" or "sources say"
- General sector commentary
- Routine analyst reiterations

Answer with only YES or NO.`,
        messages: [{
          role: 'user',
          content: `Company: ${ticker}\n\nNew headlines since last analysis:\n${fresh.slice(0,8).map((h,i)=>`${i+1}. ${h}`).join('\n')}\n\nAre any of these material?`
        }]
      })
    });
    if(!r.ok) return false;
    const d = await r.json();
    const answer = d.content?.[0]?.text?.trim().toUpperCase();
    return answer === 'YES';
  } catch(e) { return false; }
}

// Main cache validation logic
async function validateCache(cached, ticker) {
  const reasons = [];

  // 1. Age check — hard 6h ceiling
  const age = Date.now() - new Date(cached.generated).getTime();
  if(age > MAX_AGE_MS) {
    reasons.push(`Age ${Math.round(age/3600000)}h exceeds 6h limit`);
    return { valid: false, reasons };
  }

  // 2. Earnings window check — if earnings in next 48h, always refresh
  const earningsCheck = await sf(
    `https://finnhub.io/api/v1/calendar/earnings?symbol=${ticker}&from=${new Date().toISOString().split('T')[0]}&to=${new Date(Date.now()+EARNINGS_WINDOW_MS).toISOString().split('T')[0]}&token=${FINNHUB}`,
    4000
  );
  if(earningsCheck?.earningsCalendar?.length) {
    reasons.push('Earnings within 48 hours');
    return { valid: false, reasons };
  }

  // 3. Price move check — run in parallel with news check
  const [quote, newsData] = await Promise.all([
    sf(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`, 4000),
    sf(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${new Date(Date.now()-86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${FINNHUB}`, 4000),
  ]);

  if(quote?.c && cached.priceAtGeneration) {
    const move = Math.abs((quote.c - cached.priceAtGeneration) / cached.priceAtGeneration);
    if(move >= PRICE_MOVE_THRESHOLD) {
      reasons.push(`Price moved ${(move*100).toFixed(1)}% (≥2% threshold)`);
      return { valid: false, reasons };
    }
  }

  // 4. Material news check via Haiku
  const newHeadlines = (newsData || []).slice(0, 10).map(n => n.headline);
  const materialNews = await isNewsMaterial(ticker, cached.headlines, newHeadlines);
  if(materialNews) {
    reasons.push('Material news detected');
    return { valid: false, reasons };
  }

  return { valid: true, reasons: [`Age ${Math.round(age/60000)}m, price stable, no material news`] };
}

export default async function handler(req) {
  if(req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const action = url.searchParams.get('action') || 'check'; // check | store | invalidate

  if(!ticker) return new Response(JSON.stringify({ error: 'No ticker' }), { status: 400, headers: CORS });

  // ── STORE: save new analysis to cache
  if(action === 'store' && req.method === 'POST') {
    try {
      const body = await req.json();
      const existing = await readCache(ticker);
      const cacheData = {
        ticker,
        generated: new Date().toISOString(),
        priceAtGeneration: body.price || null,
        headlines: body.headlines || [],
        analysis: body.analysis,
        version: 2,
      };
      const saved = await writeCache(ticker, cacheData, existing?.sha);
      return new Response(JSON.stringify({ saved, ticker }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── INVALIDATE: force cache bust
  if(action === 'invalidate') {
    const existing = await readCache(ticker);
    if(existing) {
      const empty = { ticker, generated: null, invalidated: true };
      await writeCache(ticker, empty, existing.sha);
    }
    return new Response(JSON.stringify({ invalidated: true, ticker }), { headers: CORS });
  }

  // ── CHECK: validate existing cache and return if valid
  const cached = await readCache(ticker);

  if(!cached?.data?.analysis || !cached.data.generated || cached.data.invalidated) {
    return new Response(JSON.stringify({ hit: false, reason: 'No cache', ticker }), { headers: CORS });
  }

  const { valid, reasons } = await validateCache(cached.data, ticker);

  if(!valid) {
    return new Response(JSON.stringify({
      hit: false,
      reason: reasons.join(', '),
      ticker,
      cacheAge: cached.data.generated ? Math.round((Date.now()-new Date(cached.data.generated).getTime())/60000)+'m' : null,
    }), { headers: CORS });
  }

  // Cache hit — return the stored analysis
  return new Response(JSON.stringify({
    hit: true,
    ticker,
    generated: cached.data.generated,
    priceAtGeneration: cached.data.priceAtGeneration,
    analysis: cached.data.analysis,
    reason: reasons[0],
  }), { headers: CORS });
}
