// Receives Reg SHO data from browser and saves to GitHub Gist
export const config = { maxDuration: 10 };

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = process.env.GITHUB_TOKEN;
  const gistId = process.env.REGSHO_GIST_ID;
  if (!token || !gistId) return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'regsho.json': { content: JSON.stringify({ ...body, savedAt: new Date().toISOString() }) } } }),
    });
    if (!res.ok) throw new Error(`Gist update failed: ${res.status}`);
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
