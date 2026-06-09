export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const ticker = (body.ticker || '').toUpperCase();
    const tier = body.tier || 'free';
    const model = tier === 'paid' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
    const messages = body.messages || [];

    // Skip cache for chat queries (they have _chat_ or _q_ in ticker key)
    const isChat = ticker.includes('_CHAT_') || ticker.includes('_Q_');

    // Get real-time quote to inject into prompt
    let livePrice = null;
    const baseTicker = ticker.replace(/_.*/, '');
    if (baseTicker && baseTicker.length <= 10 && !isChat) {
      try {
        const qr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${baseTicker}&token=d8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0`);
        const qd = await qr.json();
        if (qd?.c) livePrice = { price: qd.c, change: qd.d, changePct: qd.dp };
      } catch(e) {}
    }

    // Inject live price into messages for analysis (not chat)
    let finalMessages = messages;
    if (livePrice && !isChat && finalMessages.length > 0) {
      const priceNote = `\n\n[LIVE MARKET DATA] Current price: $${livePrice.price.toFixed(2)} | Change: ${livePrice.change > 0 ? '+' : ''}${livePrice.change.toFixed(2)} (${livePrice.changePct > 0 ? '+' : ''}${livePrice.changePct.toFixed(2)}%) as of right now.`;
      finalMessages = finalMessages.map((m, i) => i === 0 ? { ...m, content: m.content + priceNote } : m);
    }

    // Call Claude
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: 1024, stream: false, messages: finalMessages }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      return new Response(JSON.stringify({ error: err }), { status: anthropicResp.status, headers: CORS });
    }

    const aiData = await anthropicResp.json();
    const text = aiData?.content?.[0]?.text || '';

    return new Response(JSON.stringify({ cached: false, text, ticker, tier, livePrice }), {
      headers: { ...CORS, 'X-Cache': 'MISS' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500, headers: CORS
    });
  }
}
