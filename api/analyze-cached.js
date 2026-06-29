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

    const model = 'claude-sonnet-4-6';
    const system = body.system || 'You are an institutional stock analyst. Use web_search to find current news before answering questions about recent events, leadership changes, or anything time-sensitive.';

    // Use a TransformStream to fake SSE streaming while handling tool loop
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();

    const sendText = async (text) => {
      const chunk = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
      await writer.write(enc.encode('data: ' + chunk + '\n\n'));
    };

    // Run tool loop in background
    (async () => {
      try {
        let msgs = [...messages];
        let finalText = '';
        let iterations = 0;

        while (iterations < 5) {
          iterations++;
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'web-search-2025-03-05'
            },
            body: JSON.stringify({
              model,
              max_tokens: 2000,
              system,
              messages: msgs,
              tools: [{ type: 'web_search_20250305', name: 'web_search' }]
            })
          });

          if (!resp.ok) {
            const err = await resp.text();
            await sendText('Error: ' + err.slice(0, 200));
            break;
          }

          const data = await resp.json();
          const stopReason = data.stop_reason;
          const content = data.content || [];

          // Extract text blocks
          const textBlocks = content.filter(b => b.type === 'text');
          if (textBlocks.length) {
            finalText = textBlocks.map(b => b.text).join('');
          }

          // If tool_use, handle the search loop
          const toolUses = content.filter(b => b.type === 'tool_use');
          if (stopReason === 'tool_use' && toolUses.length) {
            // Signal searching
            await sendText('');

            // Add assistant message with tool use
            msgs.push({ role: 'assistant', content });

            // Build tool results
            const toolResults = toolUses.map(tu => ({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: tu.type === 'web_search_20250305' ? [] : []
            }));
            msgs.push({ role: 'user', content: toolResults });
            continue;
          }

          // Done — stream the final text
          if (finalText) {
            // Stream in chunks for effect
            const words = finalText.split(' ');
            for (let i = 0; i < words.length; i += 5) {
              const chunk = words.slice(i, i + 5).join(' ') + (i + 5 < words.length ? ' ' : '');
              await sendText(chunk);
            }
          }
          break;
        }
      } catch (e) {
        await sendText('Analysis error: ' + e.message);
      } finally {
        await writer.write(enc.encode('data: [DONE]\n\n'));
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
