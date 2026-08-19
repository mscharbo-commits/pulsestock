export const config = { runtime: 'edge' };
export default async function handler(req) {
  // DISABLED — use /api/analyze-cached instead
  return new Response(JSON.stringify({ error: 'Endpoint disabled' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
