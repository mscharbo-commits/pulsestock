export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

// Simple in-memory cache — shared across requests on same edge instance
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  // Return cached response if fresh
  if(_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({..._cache, cached:true}), {headers:CORS});
  }

  // Market status
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(), m=et.getMinutes(), dow=et.getDay();
  const isOpen    = dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const isPreMkt  = dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30));
  const isPostMkt = dow>=1&&dow<=5&&h>=16&&h<20;
  const session   = isOpen?'Market Open':isPreMkt?'Pre-Market':isPostMkt?'After Hours':'Market Closed';
  const timeStr   = et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  // Fetch market data + news in parallel
  const PRICE_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV','XLI'];

  const [quotes, marketNews, earningsNews] = await Promise.all([
    Promise.all(PRICE_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`, 5000),
    sf(`https://finnhub.io/api/v1/news?category=merger&minId=0&token=${FINNHUB}`, 5000),
  ]);

  const data = {};
  PRICE_SYMS.forEach((s,i) => {
    const d = quotes[i];
    if(d && (d.c||d.pc)) data[s] = {price:d.c||d.pc, pct:d.dp||0, change:d.d||0};
  });

  // Get top 8 market-moving headlines from last 6 hours
  const sixHoursAgo = Math.floor(Date.now()/1000) - (6*3600);
  const allNews = [...(marketNews||[]), ...(earningsNews||[])]
    .filter(n => n.datetime > sixHoursAgo)
    .sort((a,b) => b.datetime - a.datetime)
    .slice(0, 8);

  const headlines = allNews.map(n => `• ${n.headline} (${n.source})`).join('\n');

  // Build price summary
  function fmt(s) {
    const d = data[s];
    if(!d) return `${s}: N/A`;
    const dir = d.pct>=0?'▲':'▼';
    return `${s} $${d.price.toFixed(2)} ${dir}${Math.abs(d.pct).toFixed(2)}%`;
  }

  const priceSummary = [
    `Indexes: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VIX: ${data.VIX?data.VIX.price.toFixed(1):'N/A'} | Bonds: ${fmt('TLT')}`,
    `Mega-caps: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')}`,
    `Sectors: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Fins ${fmt('XLF')} | Health ${fmt('XLV')} | Ind ${fmt('XLI')}`,
  ].join('\n');

  let narrative = 'Market data loaded — AI narrative unavailable.';

  if(ANTHROPIC) {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: `You are a senior market analyst on a trading desk writing a real-time market pulse update. 
Your job: synthesize the price action AND the news headlines into a cohesive narrative that explains WHY the market is moving, not just HOW MUCH.
Rules:
- Write exactly 3-4 sentences
- Lead with the dominant market theme
- Connect specific news catalysts to the price moves you see
- Name the biggest mover and explain the catalyst if visible in the headlines
- End with one key level or dynamic to watch
- Use specific numbers from the data
- Present tense, active voice, sharp and direct
- No disclaimers, no "as of", no "it's worth noting"`,
        messages:[{
          role:'user',
          content:`Session: ${session} | ${timeStr}

PRICE ACTION:
${priceSummary}

RECENT NEWS CATALYSTS (last 6 hours):
${headlines || 'No major headlines in the last 6 hours.'}

Write the market pulse narrative.`
        }]
      })
    });

    if(aiResp.ok) {
      const aiData = await aiResp.json();
      narrative = aiData.content?.[0]?.text || narrative;
    }
  }

  const result = {narrative, data, session, isOpen, timeStr, headlines: allNews.slice(0,5).map(n=>({headline:n.headline, source:n.source, url:n.url}))};

  // Cache it
  _cache = result;
  _cacheTime = Date.now();

  return new Response(JSON.stringify(result), {headers:CORS});
}
