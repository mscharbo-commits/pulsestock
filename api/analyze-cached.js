export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  console.log('[analyze-cached] POST received');

  try {
    const body = await req.json();
    const ticker = (body.ticker || '').toUpperCase();
    const tier = body.tier || 'free';
    const model = tier === 'paid' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
    const messages = body.messages || [];

    console.log('[analyze-cached] ticker:', ticker, 'model:', model, 'messages:', messages.length);

    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400, headers: CORS });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[analyze-cached] ANTHROPIC_API_KEY not set!');
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: CORS });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    console.log('[analyze-cached] calling Claude...');

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: 512, stream: false, messages }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    console.log('[analyze-cached] Claude status:', anthropicResp.status);

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      console.error('[analyze-cached] Claude error:', err.slice(0, 200));
      return new Response(JSON.stringify({ error: 'Claude API error: ' + anthropicResp.status }), { status: 500, headers: CORS });
    }

    const aiData = await anthropicResp.json();
    const text = aiData?.content?.[0]?.text || '';
    console.log('[analyze-cached] got response, length:', text.length);

    return new Response(JSON.stringify({ cached: false, text, ticker }), { headers: CORS });

  } catch (err) {
    console.error('[analyze-cached] error:', err.message);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), { status: 500, headers: CORS });
  }
}
