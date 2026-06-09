export const config = { runtime: 'edge' };

const GIST_TOKEN = process.env.GITHUB_TOKEN;
const CACHE_GIST_ID = '62da6ca37aaebed90bceaeb4add4d4ef';
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function getCache() {
  try {
    const r = await fetch(`https://api.github.com/gists/${CACHE_GIST_ID}`, {
      headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'User-Agent': 'PulseStock' }
    });
    const data = await r.json();
    const raw = data?.files?.['ai_cache.json']?.content;
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

async function saveCache(cache) {
  try {
    await fetch(`https://api.github.com/gists/${CACHE_GIST_ID}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'PulseStock' },
      body: JSON.stringify({ files: { 'ai_cache.json': { content: JSON.stringify(cache) } } })
    });
  } catch(e) {}
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const ticker = body.ticker?.toUpperCase();
    const tier = body.tier || 'free';
    const model = tier === 'paid' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

    // ── Check cache ────────────────────────────────────────────────────────
    if (ticker) {
      const cacheKey = `${ticker}_${tier}`;
      const cache = await getCache();
      const cached = cache[cacheKey];
      if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        // Return cached result as a fake stream
        const text = cached.text;
        return new Response(JSON.stringify({ cached: true, text, ticker, tier, age: Math.round((Date.now() - cached.ts) / 60000) }), {
          headers: { ...CORS, 'X-Cache': 'HIT' }
        });
      }
    }

    // ── Get real-time quote to inject into prompt ──────────────────────────
    let livePrice = null;
    if (ticker) {
      try {
        const qr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`);
        const qd = await qr.json();
        if (qd?.c) livePrice = { price: qd.c, change: qd.d, changePct: qd.dp };
      } catch(e) {}
    }

    // ── Inject live price into messages ────────────────────────────────────
    let messages = body.messages || [];
    if (livePrice && messages.length > 0) {
      const priceNote = `\n\n[LIVE MARKET DATA] Current price: ${livePrice.price.toFixed(2)} | Change: ${livePrice.change > 0 ? '+' : ''}${livePrice.change.toFixed(2)} (${livePrice.changePct > 0 ? '+' : ''}${livePrice.changePct.toFixed(2)}%) as of right now. Use this in your analysis.`;
      messages = messages.map((m, i) => i === 0 ? { ...m, content: m.content + priceNote } : m);
    }

    // ── Call Claude (non-streaming for cacheability) ───────────────────────
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1500, stream: false, messages }),
    });

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      return new Response(err, { status: anthropicResp.status, headers: CORS });
    }

    const aiData = await anthropicResp.json();
    const text = aiData?.content?.[0]?.text || '';

    // ── Save to cache ──────────────────────────────────────────────────────
    if (ticker && text) {
      const cache = await getCache();
      const cacheKey = `${ticker}_${tier}`;
      // Keep cache from growing too large — max 50 entries
      const keys = Object.keys(cache).filter(k => !k.startsWith('_'));
      if (keys.length >= 50) {
        // Remove oldest entry
        const oldest = keys.sort((a,b) => (cache[a].ts||0) - (cache[b].ts||0))[0];
        delete cache[oldest];
      }
      cache[cacheKey] = { ts: Date.now(), text, livePrice };
      // Save cache async (don't await — don't slow down response)
      saveCache(cache);
    }

    return new Response(JSON.stringify({ cached: false, text, ticker, tier, livePrice }), {
      headers: { ...CORS, 'X-Cache': 'MISS' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
