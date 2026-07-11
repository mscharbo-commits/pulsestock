export const config = { runtime: 'edge' };
const GIST_TOKEN = process.env.GITHUB_TOKEN;
const PICKS_GIST = 'd4890f15ec44f0ea94a0916285a488aa';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  try {
    const r = await fetch(`https://api.github.com/gists/${PICKS_GIST}`,
      {headers:{'Authorization':`Bearer ${GIST_TOKEN}`,'User-Agent':'PulseStock'}});
    if(!r.ok) throw new Error('Gist fetch failed: '+r.status);
    const gist = await r.json();

    // Try enhanced_picks first, fall back to picks_cache
    const enhanced = gist.files?.['enhanced_picks.json']?.content;
    if(enhanced) {
      return new Response(enhanced, {headers:CORS});
    }
    // Legacy fallback
    const legacy = gist.files?.['picks_cache.json']?.content;
    if(legacy) return new Response(legacy, {headers:{...CORS,'X-Format':'legacy'}});
    return new Response(JSON.stringify({error:'No picks available yet'}),{status:404,headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
}
