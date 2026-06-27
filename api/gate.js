export const config = { runtime: 'edge' };

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'PulseStock2026';
const COOKIE_NAME = 'ps_demo_access';
const COOKIE_VALUE = 'granted';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const { password } = await req.json();
    if (password === DEMO_PASSWORD) {
      const headers = new Headers(CORS);
      headers.set('Set-Cookie', `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; Max-Age=86400; SameSite=Lax`);
      return new Response(JSON.stringify({ success: true }), { headers });
    }
    return new Response(JSON.stringify({ success: false, error: 'Invalid password' }), { status: 401, headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
