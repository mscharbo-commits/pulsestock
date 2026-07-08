export const config = { runtime: 'edge' };

const FINNHUB   = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

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

// Keywords that indicate market-moving economic/earnings news
const MARKET_KEYWORDS = [
  'fed','federal reserve','fomc','rate','inflation','cpi','pce','jobs','gdp','payroll',
  'earnings','revenue','profit','beat','miss','eps','guidance','outlook','forecast',
  'yield','treasury','bond','rate cut','rate hike','interest rate',
  'economic','economy','recession','growth','unemployment','retail sales',
  'ism','pmi','manufacturing','housing','consumer','spending',
  'rally','selloff','sell-off','plunge','surge','jump','drop','decline','gain',
  'stocks','market','nasdaq','s&p','dow','equities','wall street',
  'oil','gold','dollar','crypto','bitcoin',
  'merger','acquisition','buyout','ipo','spinoff',
  'apple','nvidia','microsoft','meta','tesla','amazon','google','alphabet','jpmorgan',
  'semiconductor','ai','artificial intelligence','cloud','tech',
  'tariff','trade','export','import','sanctions',
  'quarter','fiscal','annual','report','results'
];

function isMarketRelevant(headline) {
  const lower = headline.toLowerCase();
  return MARKET_KEYWORDS.some(kw => lower.includes(kw));
}

// Keywords that indicate geopolitical noise to filter out
const GEO_NOISE = [
  'war','military','troops','soldier','attack','bomb','missile','ukraine','russia','israel',
  'gaza','hamas','iran','north korea','china military','taiwan strait',
  'election','vote','president','congress','senate','democrat','republican','political',
  'crime','murder','shooting','arrest','police','court','trial',
  'weather','hurricane','earthquake','flood','fire','tornado',
  'celebrity','sports','entertainment','oscar','grammy','nfl','nba','mlb'
];

function isGeoNoise(headline) {
  const lower = headline.toLowerCase();
  return GEO_NOISE.some(kw => lower.includes(kw));
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:CORS});

  if(_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({..._cache, cached:true}), {headers:CORS});
  }

  const now = new Date();
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h=et.getHours(), m=et.getMinutes(), dow=et.getDay();
  const isOpen    = dow>=1&&dow<=5&&(h>9||(h===9&&m>=30))&&h<16;
  const isPreMkt  = dow>=1&&dow<=5&&h>=4&&(h<9||(h===9&&m<30));
  const isPostMkt = dow>=1&&dow<=5&&h>=16&&h<20;
  const session   = isOpen?'Market Open':isPreMkt?'Pre-Market':isPostMkt?'After Hours':'Market Closed';
  const timeStr   = et.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' ET';

  const PRICE_SYMS = ['SPY','QQQ','DIA','IWM','VIX','TLT','AAPL','NVDA','MSFT','META','TSLA','AMZN','JPM','XLK','XLE','XLF','XLV','XLI'];

  const [quotes, generalNews, businessNews] = await Promise.all([
    Promise.all(PRICE_SYMS.map(s => sf(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB}`,4000))),
    sf(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB}`, 5000),
    sf(`https://finnhub.io/api/v1/news?category=business&minId=0&token=${FINNHUB}`, 5000),
  ]);

  const data = {};
  PRICE_SYMS.forEach((s,i) => {
    const d = quotes[i];
    if(d && (d.c||d.pc)) data[s] = {price:d.c||d.pc, pct:d.dp||0, change:d.d||0};
  });

  // Filter to market/economic news only, remove geo noise
  const sixHoursAgo = Math.floor(Date.now()/1000) - (6*3600);
  const allNews = [...(generalNews||[]), ...(businessNews||[])]
    .filter(n => n.datetime > sixHoursAgo)
    .filter(n => !isGeoNoise(n.headline))
    .filter(n => isMarketRelevant(n.headline))
    .sort((a,b) => b.datetime - a.datetime)
    .slice(0, 6);

  const headlines = allNews.length
    ? allNews.map(n => `• ${n.headline}`).join('\n')
    : 'No major economic or earnings catalysts in the last 6 hours.';

  function fmt(s) {
    const d = data[s];
    if(!d) return `${s}: N/A`;
    return `${s} $${d.price.toFixed(2)} ${d.pct>=0?'▲':'▼'}${Math.abs(d.pct).toFixed(2)}%`;
  }

  const priceSummary = [
    `Indexes: ${fmt('SPY')} | ${fmt('QQQ')} | ${fmt('DIA')} | ${fmt('IWM')}`,
    `VIX: ${data.VIX?data.VIX.price.toFixed(1):'N/A'} | Bonds (TLT): ${fmt('TLT')}`,
    `Mega-caps: ${fmt('AAPL')} | ${fmt('NVDA')} | ${fmt('MSFT')} | ${fmt('META')} | ${fmt('TSLA')} | ${fmt('AMZN')}`,
    `Sectors leading/lagging: Tech ${fmt('XLK')} | Energy ${fmt('XLE')} | Financials ${fmt('XLF')} | Healthcare ${fmt('XLV')} | Industrials ${fmt('XLI')}`,
  ].join('\n');

  let narrative = 'Market data loaded.';

  if(ANTHROPIC) {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `You are a senior market analyst writing a real-time market pulse for professional traders.
Write exactly 4 sentences that weave together the price action AND economic/earnings catalysts into one cohesive narrative.
Sentence 1: Lead with the dominant market theme and the key economic catalyst driving it (Fed, CPI, earnings, etc.)
Sentence 2: Identify sector rotation — what is leading, what is lagging and why.
Sentence 3: Call out the biggest individual mover and its catalyst if visible in the headlines.
Sentence 4: One specific level or dynamic to watch for the rest of the session.
Rules: Use exact numbers. Never split a number like 1.85 across a line break. Active voice. No disclaimers. No "it's worth noting". Sound like a Bloomberg terminal alert.`,
        messages:[{
          role:'user',
          content:`Session: ${session} | ${timeStr}

PRICE ACTION:
${priceSummary}

ECONOMIC & EARNINGS CATALYSTS (last 6 hours):
${headlines}

Write the 4-sentence market pulse narrative.`
        }]
      })
    });

    if(aiResp.ok) {
      const aiData = await aiResp.json();
      narrative = aiData.content?.[0]?.text || narrative;
    }
  }

  const result = {
    narrative, data, session, isOpen, timeStr,
    headlines: allNews.slice(0,5).map(n=>({headline:n.headline, source:n.source, url:n.url}))
  };

  _cache = result;
  _cacheTime = Date.now();

  return new Response(JSON.stringify(result), {headers:CORS});
}
