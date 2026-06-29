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

    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Always Sonnet — required for web search
    const model = 'claude-sonnet-4-6';

    // Build request — include system message if provided
    const claudeBody = {
      model,
      max_tokens: 1500,
      stream: true,
      messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    };

    // Pass system message if provided
    if (body.system) {
      claudeBody.system = body.system;
    }

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(claudeBody)
    });

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      return new Response(JSON.stringify({ error: 'Claude API error: ' + anthropicResp.status + ' ' + err.slice(0,200) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(anthropicResp.body, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
