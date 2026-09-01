export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sf(url, t=8000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), t);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

const META = {
  'bitcoin':        { sym:'BTC',  name:'Bitcoin',           tvSym:'BINANCE:BTCUSDT',  img:'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' },
  'ethereum':       { sym:'ETH',  name:'Ethereum',          tvSym:'BINANCE:ETHUSDT',  img:'https://assets.coingecko.com/coins/images/279/large/ethereum.png' },
  'solana':         { sym:'SOL',  name:'Solana',            tvSym:'BINANCE:SOLUSDT',  img:'https://assets.coingecko.com/coins/images/4128/large/solana.png' },
  'ripple':         { sym:'XRP',  name:'XRP',               tvSym:'BINANCE:XRPUSDT',  img:'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png' },
  'dogecoin':       { sym:'DOGE', name:'Dogecoin',          tvSym:'BINANCE:DOGEUSDT', img:'https://assets.coingecko.com/coins/images/5/large/dogecoin.png' },
  'cardano':        { sym:'ADA',  name:'Cardano',           tvSym:'BINANCE:ADAUSDT',  img:'https://assets.coingecko.com/coins/images/975/large/cardano.png' },
  'avalanche-2':    { sym:'AVAX', name:'Avalanche',         tvSym:'BINANCE:AVAXUSDT', img:'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png' },
  'polkadot':       { sym:'DOT',  name:'Polkadot',          tvSym:'BINANCE:DOTUSDT',  img:'https://assets.coingecko.com/coins/images/12171/large/polkadot.png' },
  'chainlink':      { sym:'LINK', name:'Chainlink',         tvSym:'BINANCE:LINKUSDT', img:'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png' },
  'matic-network':  { sym:'MATIC',name:'Polygon',           tvSym:'BINANCE:MATICUSDT',img:'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png' },
  'uniswap':        { sym:'UNI',  name:'Uniswap',           tvSym:'BINANCE:UNIUSDT',  img:'https://assets.coingecko.com/coins/images/12504/large/uniswap-uni.png' },
  'litecoin':       { sym:'LTC',  name:'Litecoin',          tvSym:'BINANCE:LTCUSDT',  img:'https://assets.coingecko.com/coins/images/2/large/litecoin.png' },
  'near':           { sym:'NEAR', name:'NEAR Protocol',     tvSym:'BINANCE:NEARUSDT', img:'https://assets.coingecko.com/coins/images/10365/large/near.jpg' },
  'aptos':          { sym:'APT',  name:'Aptos',             tvSym:'BINANCE:APTUSDT',  img:'https://assets.coingecko.com/coins/images/26455/large/aptos_round.png' },
  'arbitrum':       { sym:'ARB',  name:'Arbitrum',          tvSym:'BINANCE:ARBUSDT',  img:'https://assets.coingecko.com/coins/images/16547/large/photo_2023-03-29_21.47.00.jpeg' },
  'cosmos':         { sym:'ATOM', name:'Cosmos',            tvSym:'BINANCE:ATOMUSDT', img:'https://assets.coingecko.com/coins/images/1481/large/cosmos_hub.png' },
  'shiba-inu':      { sym:'SHIB', name:'Shiba Inu',         tvSym:'BINANCE:SHIBUSDT', img:'https://assets.coingecko.com/coins/images/11939/large/shiba.png' },
  'tron':           { sym:'TRX',  name:'TRON',              tvSym:'BINANCE:TRXUSDT',  img:'https://assets.coingecko.com/coins/images/1094/large/tron-logo.png' },
  'the-open-network':{ sym:'TON', name:'Toncoin',           tvSym:'BINANCE:TONUSDT',  img:'https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png' },
  'sui':            { sym:'SUI',  name:'Sui',               tvSym:'BINANCE:SUIUSDT',  img:'https://assets.coingecko.com/coins/images/26375/large/sui_asset.jpeg' },
  'pepe':           { sym:'PEPE', name:'Pepe',              tvSym:'BINANCE:PEPEUSDT', img:'https://assets.coingecko.com/coins/images/29850/large/pepe-token.jpeg' },
  'bitcoin-cash':   { sym:'BCH',  name:'Bitcoin Cash',      tvSym:'BINANCE:BCHUSDT',  img:'https://assets.coingecko.com/coins/images/780/large/bitcoin-cash-circle.png' },
  'monero':         { sym:'XMR',  name:'Monero',            tvSym:'KRAKEN:XMRUSD',    img:'https://assets.coingecko.com/coins/images/69/large/monero_logo.png' },
  'internet-computer':{ sym:'ICP',name:'Internet Computer', tvSym:'BINANCE:ICPUSDT',  img:'https://assets.coingecko.com/coins/images/14495/large/Internet_Computer_logo.png' },
  'aave':           { sym:'AAVE', name:'Aave',              tvSym:'BINANCE:AAVEUSDT', img:'https://assets.coingecko.com/coins/images/12645/large/AAVE.png' },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const { searchParams } = new URL(req.url);
  const coinId = (searchParams.get('id') || '').toLowerCase().trim();
  if (!coinId) return new Response(JSON.stringify({ error: 'No coin ID' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const meta = META[coinId] || {
    sym: coinId.toUpperCase().slice(0,6),
    name: coinId.charAt(0).toUpperCase() + coinId.slice(1).replace(/-/g,' '),
    tvSym: 'BINANCE:' + coinId.toUpperCase().replace(/-/g,'') + 'USDT',
    img: null,
  };

  // Use simple/price — proven to work from Vercel edge
  const fields = 'usd,usd_24h_change,usd_market_cap,usd_24h_vol,usd_7d_change,usd_30d_change,usd_1y_change';
  const priceData = await sf(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
  );

  const p = priceData && priceData[coinId];
  if (!p) {
    return new Response(JSON.stringify({ error: 'Coin not found or API unavailable' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const result = {
    id: coinId,
    sym: meta.sym,
    name: meta.name,
    tvSym: meta.tvSym,
    image: meta.img ? { large: meta.img } : null,
    rank: null,
    price: p.usd || 0,
    chg24: p.usd_24h_change || 0,
    chg7: null,
    chg30: null,
    chg1y: null,
    marketCap: p.usd_market_cap || null,
    volume24: p.usd_24h_vol || null,
    fdv: null,
    circSupply: null,
    totalSupply: null,
    maxSupply: null,
    ath: null, athChg: null, athDate: null,
    atl: null, atlChg: null, atlDate: null,
    sentiment_up: null, sentiment_dn: null,
    coingecko_score: null,
    description: null, links: null,
  };

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }
  });
}
