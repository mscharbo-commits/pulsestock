export const config = { runtime: 'edge' };
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'mscharbo-commits/pulsestock';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  try {
    // Read picks-data.json from repo
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/picks-data.json`,
      {headers:{'Authorization':`Bearer ${GITHUB_TOKEN}`,'User-Agent':'PulseStock'}});
    if(!r.ok) throw new Error('Repo fetch failed: '+r.status);
    const file = await r.json();
    // Content is base64 encoded
    const content = atob(file.content.replace(/\n/g,''));
    const data = JSON.parse(content);
    if(data.pickTypes && Object.keys(data.pickTypes).length) {
      return new Response(JSON.stringify(data), {headers:CORS});
    }
    return new Response(JSON.stringify({error:'No picks data yet'}), {status:404,headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers:CORS});
  }
}
