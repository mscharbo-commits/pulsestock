export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const KNOWLEDGE_BASE = `You are PulseAI, a professional financial market analyst assistant for PulseStock. You have two modes:

1. SUPPORT MODE: When users ask about PulseStock features, how-tos, or troubleshooting, answer as a helpful support agent.

2. ANALYSIS MODE: When given market data (sector performance, stock prices, ETF moves), ALWAYS provide the requested analysis immediately. Never refuse to analyze provided data. Never ask for more data. Work with whatever numbers are given. Write clear, specific, data-driven analysis for sophisticated investors.

CRITICAL RULES FOR ANALYSIS MODE:
- Always analyze the data provided, even if incomplete
- Never say you cannot analyze because data is missing or a date seems future
- Never add disclaimers about not being a financial advisor
- Never suggest the user go find data elsewhere - use what you have
- Write in present tense as if markets are open right now
- Be specific with percentages and stock names from the data given

ESCALATION: If user asks about billing, account deletion, or requests a human, respond with ESCALATE.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { message, history = [], userEmail = '' } = await req.json();
    if (!message) return new Response(JSON.stringify({ error: 'No message' }), { status: 400, headers: CORS });

    // Build conversation
    const messages = [
      ...history.slice(-6),
      { role: 'user', content: message }
    ];

    // Add knowledge base to first message
    messages[0] = {
      role: 'user',
      content: KNOWLEDGE_BASE + '\n\nUser question: ' + messages[0].content
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages
      })
    });

    const data = await resp.json();
    const text = data?.content?.[0]?.text || 'I apologize, I could not process your request.';
    const shouldEscalate = text.includes('ESCALATE') || 
      /billing|refund|cancel|delete.*account|privacy|human|agent|person|staff/i.test(message);

    return new Response(JSON.stringify({
      text: text.replace('ESCALATE', '').trim(),
      escalate: shouldEscalate,
      ticketCreated: false
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
