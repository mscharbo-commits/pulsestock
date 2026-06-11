export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const KNOWLEDGE_BASE = `You are PulseAI Support, the helpful assistant for PulseStock — an AI-powered stock analysis platform.

ABOUT PULSESTOCK:
- Real-time stock quotes, charts, and AI analysis powered by Claude AI
- Features: Stock analyzer, Screener, Buy-In scanner, Portfolio tracker, Community picks, News, SEC Filings, Insider transactions, Technical indicators, Earnings calendar
- Free tier: Basic analysis with Claude Haiku model
- Paid tier: Deep analysis with Claude Sonnet, advanced features
- Desktop Ticker app available for download at /desktop
- Morning Picks: Daily AI-curated stock picks at /morning-picks (internal)

COMMON FEATURES:
- To analyze a stock: type ticker in search box on homepage and click Analyze
- To add to watchlist: click ⭐ Watchlist in nav after analyzing a stock
- To add to portfolio: click Portfolio in nav, type ticker and click + Add
- To add stock to ticker bar: add to portfolio and check "add to ticker bar" prompt
- To edit ticker bar: click ✏️ Edit button next to MARKETS bar
- Community: join at /community.html — share picks, chat, track leaderboard
- To post a pick: go to community, click Picks tab, fill in ticker/direction/entry/target/stop
- To close a pick: find your pick in community, click "Close Pick" button
- AI chat on stock page: analyze any stock, scroll to "Ask PulseAI" section, click chips or type question
- News load more: click "Load older news" button below news section
- Morning Picks: runs at 8:30am ET daily, covers 30 stocks across sectors

TROUBLESHOOTING:
- Chart not loading: try refreshing the page (Cmd+Shift+R)
- Data not updating: market data is real-time during trading hours (9:30am-4pm ET)
- Community login: use same account as main site signin
- Forgot password: go to /signin and click "Forgot password?"

ESCALATION: If you cannot confidently answer, or if the user asks about billing, account deletion, data privacy, or requests a human — respond with ESCALATE in your response.`;

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
