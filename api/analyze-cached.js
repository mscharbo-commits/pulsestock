export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const messages = body.messages || [];
    if (!messages.length) return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (!process.env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const system = body.system || 'You are an institutional stock analyst. Be concise and data-driven. Respond in 3-4 focused paragraphs.';

    // Use TRUE streaming so first token arrives within seconds
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: true,
        system,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err.slice(0,300) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Pipe the SSE stream directly to client
    return new Response(resp.body, {
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
