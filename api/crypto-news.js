export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type'
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') || '').toLowerCase();
  const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';

  // Keyword map for filtering general crypto news
  const COIN_KEYWORDS = {
    'bitcoin': ['bitcoin','btc'],
    'ethereum': ['ethereum','eth'],
    'solana': ['solana','sol'],
    'ripple': ['ripple','xrp'],
    'dogecoin': ['dogecoin','doge'],
    'cardano': ['cardano','ada'],
    'avalanche-2': ['avalanche','avax'],
    'polkadot': ['polkadot','dot'],
    'chainlink': ['chainlink','link'],
    'matic-network': ['polygon','matic'],
    'shiba-inu': ['shiba','shib'],
    'uniswap': ['uniswap','uni'],
    'near': ['near protocol','near'],
    'aptos': ['aptos','apt'],
    'arbitrum': ['arbitrum','arb'],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // Fetch general crypto news from Finnhub
    const res = await fetch(
      'https://finnhub.io/api/v1/news?category=crypto&token=' + FINNHUB,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Finnhub error: ' + res.status);
    const data = await res.json();

    let news = Array.isArray(data) ? data : [];

    // Filter by coin keywords if specified
    if (coin && COIN_KEYWORDS[coin]) {
      const keywords = COIN_KEYWORDS[coin];
      news = news.filter(function(item) {
        var text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
        return keywords.some(function(kw) { return text.indexOf(kw) >= 0; });
      });
    }

    // Deduplicate and format
    const seen = new Set();
    news = news
      .filter(function(n) {
        if (seen.has(n.headline)) return false;
        seen.add(n.headline);
        return true;
      })
      .slice(0, 20)
      .map(function(n) {
        return {
          headline: n.headline,
          summary: n.summary,
          source: n.source,
          url: n.url,
          image: n.image || '',
          datetime: n.datetime,
        };
      });

    return new Response(JSON.stringify(news), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  } catch(err) {
    return new Response(JSON.stringify([]), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
