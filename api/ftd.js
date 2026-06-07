// FTD data is now fetched client-side directly from FINRA/Nasdaq
// This endpoint kept for backwards compatibility
export default async function handler(req) {
  return new Response(JSON.stringify({ clientSide: true }), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
  });
}
