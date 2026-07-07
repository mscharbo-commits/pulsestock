export const config = { runtime: 'edge' };
export default async function handler(req) {
  const AV = 'demo';
  try {
    const [wti, gold] = await Promise.all([
      fetch(`https://www.alphavantage.co/query?function=WTI&interval=daily&apikey=${AV}`).then(r=>r.json()),
      fetch(`https://www.alphavantage.co/query?function=COPPER&interval=daily&apikey=${AV}`).then(r=>r.json()),
    ]);
    return new Response(JSON.stringify({
      wti: wti?.data?.slice(0,2),
      gold: gold?.data?.slice(0,2),
      wti_keys: Object.keys(wti||{}),
    }), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {headers:{'Content-Type':'application/json'}});
  }
}