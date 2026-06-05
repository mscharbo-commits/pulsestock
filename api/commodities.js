export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getQuote(symbol) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    const price = (d.c && d.c > 0) ? d.c : (d.pc || 0);
    const pct = (d.c && d.c > 0) ? (d.dp || 0) : 0;
    const change = (d.c && d.c > 0) ? (d.d || 0) : 0;
    return { symbol, price, change, pct, high: d.h||0, low: d.l||0, prevClose: d.pc||0, open: d.o||0 };
  } catch(e) { return { symbol, price: 0, change: 0, pct: 0 }; }
}

async function getNews(category) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=${category}&minId=0&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return (d || []).slice(0, 6);
  } catch(e) { return []; }
}

const COMMODITIES = [
  { sym: 'USO',  label: 'Crude Oil (WTI)',  icon: '🛢️', unit: 'per barrel', group: 'energy', description: 'West Texas Intermediate crude oil ETF proxy' },
  { sym: 'DBO',  label: 'Brent Crude Oil',  icon: '🛢️', unit: 'per barrel', group: 'energy', description: 'Brent crude oil ETF proxy' },
  { sym: 'UNG',  label: 'Natural Gas',       icon: '⚡', unit: 'per MMBtu',  group: 'energy', description: 'US natural gas ETF proxy' },
  { sym: 'GLD',  label: 'Gold',              icon: '🥇', unit: 'per oz',    group: 'metals', description: 'SPDR Gold Shares ETF' },
  { sym: 'SLV',  label: 'Silver',            icon: '🥈', unit: 'per oz',    group: 'metals', description: 'iShares Silver Trust ETF' },
  { sym: 'PPLT', label: 'Platinum',          icon: '⬜', unit: 'per oz',    group: 'metals', description: 'Platinum ETF proxy' },
  { sym: 'CPER', label: 'Copper',            icon: '🟤', unit: 'per lb',    group: 'metals', description: 'Copper ETF proxy' },
  { sym: 'WEAT', label: 'Wheat',             icon: '🌾', unit: 'per bushel', group: 'agriculture', description: 'Teucrium Wheat ETF' },
  { sym: 'CORN', label: 'Corn',              icon: '🌽', unit: 'per bushel', group: 'agriculture', description: 'Teucrium Corn ETF' },
  { sym: 'SOYB', label: 'Soybeans',          icon: '🫘', unit: 'per bushel', group: 'agriculture', description: 'Teucrium Soybean ETF' },
  { sym: 'NIB',  label: 'Cocoa',             icon: '🍫', unit: 'per ton',   group: 'agriculture', description: 'iPath Bloomberg Cocoa ETN' },
  { sym: 'SGG',  label: 'Sugar',             icon: '🍬', unit: 'per lb',    group: 'agriculture', description: 'iPath Bloomberg Sugar ETN' },
  { sym: 'UUP',  label: 'US Dollar Index',   icon: '💵', unit: 'index',     group: 'currencies', description: 'Invesco DB US Dollar Bullish ETF' },
  { sym: 'FXE',  label: 'EUR/USD',           icon: '💶', unit: 'exchange',  group: 'currencies', description: 'Invesco CurrencyShares Euro ETF' },
  { sym: 'FXY',  label: 'USD/JPY',           icon: '💴', unit: 'exchange',  group: 'currencies', description: 'Invesco CurrencyShares Japanese Yen ETF' },
  { sym: 'FXB',  label: 'GBP/USD',           icon: '💷', unit: 'exchange',  group: 'currencies', description: 'Invesco CurrencyShares British Pound ETF' },
  { sym: 'BTC-USD', label: 'Bitcoin',        icon: '₿',  unit: 'USD',       group: 'crypto', description: 'Bitcoin spot price' },
  { sym: 'ETH-USD', label: 'Ethereum',       icon: '⟠',  unit: 'USD',       group: 'crypto', description: 'Ethereum spot price' },
];

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const group = url.searchParams.get('group'); // energy, metals, agriculture, currencies, crypto

  try {
    const targets = group ? COMMODITIES.filter(c => c.group === group) : COMMODITIES;
    const [quotes, news] = await Promise.all([
      Promise.all(targets.map(async c => {
        const q = await getQuote(c.sym);
        return { ...c, ...q };
      })),
      getNews('general'),
    ]);

    // Group results
    const grouped = {};
    quotes.forEach(q => {
      if (!grouped[q.group]) grouped[q.group] = [];
      grouped[q.group].push(q);
    });

    return new Response(JSON.stringify({
      commodities: quotes,
      grouped,
      news,
      timestamp: new Date().toISOString(),
      note: 'Prices are ETF proxies — closely track but do not equal spot prices',
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
