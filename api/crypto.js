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

// CoinGecko ID → metadata map
const COIN_META = {
  'bitcoin':       { sym:'BTC', name:'Bitcoin',          tvSym:'BINANCE:BTCUSDT' },
  'ethereum':      { sym:'ETH', name:'Ethereum',         tvSym:'BINANCE:ETHUSDT' },
  'solana':        { sym:'SOL', name:'Solana',           tvSym:'BINANCE:SOLUSDT' },
  'ripple':        { sym:'XRP', name:'XRP',              tvSym:'BINANCE:XRPUSDT' },
  'dogecoin':      { sym:'DOGE',name:'Dogecoin',         tvSym:'BINANCE:DOGEUSDT'},
  'cardano':       { sym:'ADA', name:'Cardano',          tvSym:'BINANCE:ADAUSDT' },
  'avalanche-2':   { sym:'AVAX',name:'Avalanche',        tvSym:'BINANCE:AVAXUSDT'},
  'polkadot':      { sym:'DOT', name:'Polkadot',         tvSym:'BINANCE:DOTUSDT' },
  'chainlink':     { sym:'LINK',name:'Chainlink',        tvSym:'BINANCE:LINKUSDT'},
  'matic-network': { sym:'MATIC',name:'Polygon',         tvSym:'BINANCE:MATICUSDT'},
  'uniswap':       { sym:'UNI', name:'Uniswap',          tvSym:'BINANCE:UNIUSDT' },
  'litecoin':      { sym:'LTC', name:'Litecoin',         tvSym:'BINANCE:LTCUSDT' },
  'near':          { sym:'NEAR',name:'NEAR Protocol',    tvSym:'BINANCE:NEARUSDT'},
  'aptos':         { sym:'APT', name:'Aptos',            tvSym:'BINANCE:APTUSDT' },
  'arbitrum':      { sym:'ARB', name:'Arbitrum',         tvSym:'BINANCE:ARBUSDT' },
  'cosmos':        { sym:'ATOM',name:'Cosmos',           tvSym:'BINANCE:ATOMUSDT'},
  'shiba-inu':     { sym:'SHIB',name:'Shiba Inu',        tvSym:'BINANCE:SHIBUSDT'},
  'tron':          { sym:'TRX', name:'TRON',             tvSym:'BINANCE:TRXUSDT' },
  'the-open-network':{ sym:'TON',name:'Toncoin',         tvSym:'BINANCE:TONUSDT' },
  'sui':           { sym:'SUI', name:'Sui',              tvSym:'BINANCE:SUIUSDT' },
  'pepe':          { sym:'PEPE',name:'Pepe',             tvSym:'BINANCE:PEPEUSDT'},
  'bitcoin-cash':  { sym:'BCH', name:'Bitcoin Cash',     tvSym:'BINANCE:BCHUSDT' },
  'monero':        { sym:'XMR', name:'Monero',           tvSym:'KRAKEN:XMRUSD'  },
  'internet-computer':{ sym:'ICP',name:'Internet Computer',tvSym:'BINANCE:ICPUSDT'},
  'fantom':        { sym:'FTM', name:'Fantom',           tvSym:'BINANCE:FTMUSDT' },
  'aave':          { sym:'AAVE',name:'Aave',             tvSym:'BINANCE:AAVEUSDT'},
  'maker':         { sym:'MKR', name:'Maker',            tvSym:'BINANCE:MKRUSDT' },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const { searchParams } = new URL(req.url);
  const coinId = (searchParams.get('id') || '').toLowerCase().trim();

  if (!coinId) return new Response(JSON.stringify({ error: 'No coin ID' }), {
    status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

  const meta = COIN_META[coinId] || { sym: coinId.toUpperCase(), name: coinId, tvSym: 'BINANCE:' + coinId.toUpperCase() + 'USDT' };

  // Fetch price + detail in parallel
  const [priceData, coinDetail] = await Promise.all([
    sf('https://api.coingecko.com/api/v3/simple/price?ids=' + coinId + '&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true&include_7d_change=true&include_30d_change=true'),
    sf('https://api.coingecko.com/api/v3/coins/' + coinId + '?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false'),
  ]);

  const p = priceData && priceData[coinId];
  const m = coinDetail && coinDetail.market_data;

  if (!p && !m) {
    return new Response(JSON.stringify({ error: 'Coin not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const result = {
    id: coinId,
    sym: meta.sym,
    name: coinDetail ? coinDetail.name : meta.name,
    tvSym: meta.tvSym,
    image: coinDetail ? coinDetail.image : null,
    rank: coinDetail ? coinDetail.market_cap_rank : null,
    description: coinDetail && coinDetail.description ? coinDetail.description.en : null,
    links: coinDetail ? coinDetail.links : null,
    sentiment_up: coinDetail ? coinDetail.sentiment_votes_up_percentage : null,
    sentiment_dn: coinDetail ? coinDetail.sentiment_votes_down_percentage : null,
    coingecko_score: coinDetail ? coinDetail.coingecko_score : null,
    // Price data
    price:        p ? p.usd : (m && m.current_price ? m.current_price.usd : null),
    chg24:        p ? p.usd_24h_change : (m ? m.price_change_percentage_24h : null),
    chg7:         m ? m.price_change_percentage_7d : null,
    chg30:        m ? m.price_change_percentage_30d : null,
    chg1y:        m ? m.price_change_percentage_1y : null,
    marketCap:    p ? p.usd_market_cap : (m && m.market_cap ? m.market_cap.usd : null),
    volume24:     p ? p.usd_24h_vol : (m && m.total_volume ? m.total_volume.usd : null),
    fdv:          m && m.fully_diluted_valuation ? m.fully_diluted_valuation.usd : null,
    circSupply:   m ? m.circulating_supply : null,
    totalSupply:  m ? m.total_supply : null,
    maxSupply:    m ? m.max_supply : null,
    ath:          m && m.ath ? m.ath.usd : null,
    athChg:       m && m.ath_change_percentage ? m.ath_change_percentage.usd : null,
    athDate:      m && m.ath_date ? m.ath_date.usd : null,
    atl:          m && m.atl ? m.atl.usd : null,
    atlChg:       m && m.atl_change_percentage ? m.atl_change_percentage.usd : null,
    atlDate:      m && m.atl_date ? m.atl_date.usd : null,
  };

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
  });
}
