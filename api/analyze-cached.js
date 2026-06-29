export const config = { runtime: 'nodejs', maxDuration: 60 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = body.messages || [];
    if (!messages.length) return res.status(400).json({ error: 'No messages' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'No API key' });

    const system = body.system || 'You are an institutional stock analyst. Use web_search to find current news before answering questions about recent events, leadership changes, or anything time-sensitive.';

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!apiResp.ok) {
      const err = await apiResp.text();
      return res.status(500).json({ error: 'Claude error ' + apiResp.status + ': ' + err.slice(0,200) });
    }

    const data = await apiResp.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || 'No response generated.';

    // Stream back as SSE for progressive display
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    const words = text.split(' ');
    for (let i = 0; i < words.length; i += 8) {
      const chunk = words.slice(i, i+8).join(' ') + (i+8 < words.length ? ' ' : '');
      const evt = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } });
      res.write('data: ' + evt + '\n\n');
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch(e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
}
