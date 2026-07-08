export const config = { runtime: 'edge' };

const FINNHUB  = process.env.FINNHUB_KEY  || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

async function sf(url, t=5000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), t);
    const r = await fetch(url, {signal:ctrl.signal});
    clearTimeout(id);
    if(!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  // Fetch all market data in parallel
  const syms = ['SPY','QQQ','DIA','IWM','VIX','TLT','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV'];
  const quotes = await Promise.all(syms.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000)));

  const data = {};
  syms.forEach((s,i) => {
    const d = quotes[i];
    if(d && (d.c||d.pc)) data[s] = {price:d.c||d.pc, pct:d.dp||0, change:d.d||0};
  });

  // Market status
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(), m=et.getMinutes(), dow=et.getDay();
  const isOpen = dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const isPreMkt = dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30));
  const isPostMkt = dow>=1&&dow<=5&&h>=16&&h<20;
  const session = isOpen?'market hours':isPreMkt?'pre-market':isPostMkt?'after hours':'closed';

  // Build data summary for Claude
  function fmt(s) {
    const d = data[s];
    if(!d) return s+': N/A';
    const arrow = d.pct>=0?'▲':'▼';
    return `${s} $${d.price.toFixed(2)} ${arrow}${Math.abs(d.pct).toFixed(2)}%`;
  }

  const summary = [
    `Session: ${session} | ${et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} ET`,
    `Indexes: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')} | VIX ${data.VIX?data.VIX.price.toFixed(1):'N/A'}`,
    `Mega-cap: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')}`,
    `Sectors: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Financials ${fmt('XLF')} | Healthcare ${fmt('XLV')}`,
    `Bonds: ${fmt('TLT')}`,
  ].join('\n');

  if(!ANTHROPIC) {
    return new Response(JSON.stringify({narrative:'AI analysis unavailable.', data}),{headers:CORS});
  }

  // Generate AI narrative
  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are a senior market analyst on a trading desk. Write a concise real-time market narrative in 3-4 sentences. 
Be specific with the actual numbers provided. Identify the dominant theme, leading sectors, key movers, and one thing to watch.
Write in present tense, active voice. Sound like a Bloomberg terminal alert — sharp, data-driven, no fluff. No disclaimers.`,
      messages:[{role:'user', content:`Current market data:\n${summary}\n\nWrite a 3-4 sentence market pulse narrative.`}]
    })
  });

  let narrative = 'Market data loaded.';
  if(aiResp.ok) {
    const aiData = await aiResp.json();
    narrative = aiData.content?.[0]?.text || narrative;
  }

  return new Response(JSON.stringify({narrative, data, session, isOpen}), {headers:CORS});
}
