export const config = { runtime: 'edge' };
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await req.json();
    const tier = body.tier || 'free';
    const model = tier === 'paid' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

    // Web search enabled on all queries — never answer current events from training data
    const requestBody = {
      model,
      max_tokens: 1500,
      stream: true,
      messages: body.messages,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ]
    };

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(requestBody),
    });

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      return new Response(err, { status: anthropicResp.status, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response(anthropicResp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
