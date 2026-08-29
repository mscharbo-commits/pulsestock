export const config = { runtime: 'edge' };

export default async function handler(req) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Only allow calls from our own domain
  const referer = req.headers.get('referer') || '';
  const host = req.headers.get('host') || '';
  const isOwn = referer.includes('pulsestock') || host.includes('pulsestock') || host.includes('localhost');
  if (!isOwn) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: CORS });

  try {
    const body = await req.json();
    const messages = body.messages || [];
    if (!messages.length) return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: CORS });

    // Use Haiku — cheap, fast, good enough for briefing summaries
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        stream: true,
        messages
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err.slice(0, 200) }), { status: 500, headers: CORS });
    }

    // Stream back to client
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
