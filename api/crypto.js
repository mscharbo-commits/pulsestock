export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CG_KEY = process.env.COINGECKO_API_KEY || '';

async function sf(url, t=8000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), t);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'x-cg-demo-api-key': CG_KEY, 'Accept': 'application/json' }
    });
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

  // Fetch full coin data + simple price in parallel
  const [coinDetail, priceData] = await Promise.all([
    sf(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`),
    sf(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`)
  ]);

  const p = priceData && priceData[coinId];
  const m = coinDetail && coinDetail.market_data;

  if (!p && !m) {
    return new Response(JSON.stringify({ error: 'Coin not found or API unavailable' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const result = {
    id: coinId,
    sym: meta.sym,
    name: coinDetail ? coinDetail.name : meta.name,
    tvSym: meta.tvSym,
    image: coinDetail ? coinDetail.image : (meta.img ? { large: meta.img } : null),
    rank: coinDetail ? coinDetail.market_cap_rank : null,
    price: (p && p.usd) || (m && m.current_price && m.current_price.usd) || 0,
    chg24: (p && p.usd_24h_change) || (m && m.price_change_percentage_24h) || 0,
    chg7:  m ? m.price_change_percentage_7d  : null,
    chg30: m ? m.price_change_percentage_30d : null,
    chg1y: m ? m.price_change_percentage_1y  : null,
    marketCap:   (p && p.usd_market_cap)  || (m && m.market_cap && m.market_cap.usd) || null,
    volume24:    (p && p.usd_24h_vol)     || (m && m.total_volume && m.total_volume.usd) || null,
    fdv:         m && m.fully_diluted_valuation ? m.fully_diluted_valuation.usd : null,
    circSupply:  m ? m.circulating_supply : null,
    totalSupply: m ? m.total_supply       : null,
    maxSupply:   m ? m.max_supply         : null,
    ath:    m && m.ath ? m.ath.usd : null,
    athChg: m && m.ath_change_percentage ? m.ath_change_percentage.usd : null,
    athDate:m && m.ath_date ? m.ath_date.usd : null,
    atl:    m && m.atl ? m.atl.usd : null,
    atlChg: m && m.atl_change_percentage ? m.atl_change_percentage.usd : null,
    atlDate:m && m.atl_date ? m.atl_date.usd : null,
    sentiment_up:    coinDetail ? coinDetail.sentiment_votes_up_percentage   : null,
    sentiment_dn:    coinDetail ? coinDetail.sentiment_votes_down_percentage  : null,
    coingecko_score: coinDetail ? coinDetail.coingecko_score : null,
    description:     coinDetail && coinDetail.description ? coinDetail.description.en : null,
    links:           coinDetail ? coinDetail.links : null,
  };

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }
  });
}
