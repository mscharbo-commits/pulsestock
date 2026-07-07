export const config = { runtime: 'edge' };
const FINNHUB_KEY = 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
  const {searchParams} = new URL(req.url);
  const ticker = searchParams.get('ticker')||'';
  if(!ticker) return new Response(JSON.stringify({error:'No ticker'}),{status:400,headers:CORS});
  try {
    const [recRes, targetRes] = await Promise.all([
      fetch('https://finnhub.io/api/v1/stock/recommendation?symbol='+ticker+'&token='+FINNHUB_KEY),
      fetch('https://finnhub.io/api/v1/stock/price-target?symbol='+ticker+'&token='+FINNHUB_KEY),
    ]);
    const rec = recRes.ok ? await recRes.json() : [];
    const target = targetRes.ok ? await targetRes.json() : {};
    return new Response(JSON.stringify({recommendations:rec.slice(0,3), priceTarget:target}),{headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
}