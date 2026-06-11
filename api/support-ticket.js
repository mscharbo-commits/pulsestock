export const config = { runtime: 'edge' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { name, email, message, category, conversation } = await req.json();

    // Store in Supabase
    const SUPA_URL = 'https://ttcprqkoibiztibhpsrp.supabase.co';
    const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_iQhPAY-M-OUbFVbLQyCp5g_540rSkd1';

    const ticket = {
      name: name || 'Anonymous',
      email: email || 'no-email',
      message,
      category: category || 'general',
      conversation: JSON.stringify(conversation || []),
      status: 'open',
      created_at: new Date().toISOString()
    };

    // Try Supabase insert
    try {
      await fetch(`${SUPA_URL}/rest/v1/support_tickets`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(ticket)
      });
    } catch(e) {}

    return new Response(JSON.stringify({ success: true, ticketId: Date.now() }), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
