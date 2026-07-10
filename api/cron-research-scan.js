// PulseStock Research Universe Scanner
// Runs daily at 8am ET on main platform (has full API access)
// Scans 3,431 tickers and saves ranked candidates to Supabase

export const config = { maxDuration: 300 }; // 5 min max

const FINNHUB = process.env.FINNHUB_KEY || 'd95c889r01qihq3l33k0d95c889r01qihq3l33kg';
const POLYGON = process.env.POLYGON_API_KEY || 'qpe_fbt2WsRl8D2YquOMzbzYlWcywazt';
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = 'https://ttcprqkoibiztibhpsrp.supabase.co';
const SUPABASE_KEY = process.env.RESEARCH_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0Y3BycWtvaWJpenRpYmhwc3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNTk5NjcsImV4cCI6MjA5NTkzNTk2N30.kO-a0NYLQ0rrAV1V7Aj4O8Mwm7KFq2NPfIQl2uY5sDY';

const TICKER_URL = 'https://raw.githubusercontent.com/mscharbo-commits/pulsestock-study-data/main/ticker_universe.json';

async function sf(url, opts = {}) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    clearTimeout(id);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function sbDelete(table, params) {
  return sf(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
}

async function sbPost(table, data) {
  return sf(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

function scoreStock(quote, metric, strategy) {
  if (!quote || !quote.c || quote.c < 5) return null;
  const m = metric?.metric || {};
  
  const price = quote.c;
  const prevClose = quote.pc || price;
  const w52h = m['52WeekHigh'] ? parseFloat(m['52WeekHigh']) : null;
  const w52l = m['52WeekLow'] ? parseFloat(m['52WeekLow']) : null;
  const rsi = m['rsi14d'] ? parseFloat(m['rsi14d']) : null;
  const beta = m['beta'] ? parseFloat(m['beta']) : null;
  
  if (!w52h || !w52l || !rsi || w52h <= w52l) return null;
  
  const rangePos = ((price - w52l) / (w52h - w52l)) * 100;
  const pctFromHigh = ((price - w52h) / w52h) * 100;
  const pctAboveLow = ((price - w52l) / w52l) * 100;
  const vwapAbove = price > prevClose;
  
  // Dollar volume check using avg volume proxy
  const avgVol = m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume'] * 1e6 : null;
  const dollarVol = avgVol ? (avgVol * price / 1e6) : null;
  if (dollarVol && dollarVol < 10) return null; // less than $10M avg daily dollar volume
  
  let score = 0;

  if (strategy === 'momentum') {
    if (rangePos < 55) return null;
    if (pctFromHigh < -25) return null;
    if (rsi < 50 || rsi > 80) return null;
    
    score += Math.min(rangePos * 0.3, 25);
    score += pctFromHigh >= -10 ? 15 : pctFromHigh >= -20 ? 8 : 3;
    score += pctAboveLow >= 30 ? 10 : 0;
    score += rsi >= 55 && rsi <= 72 ? 15 : 8;
    score += vwapAbove ? 15 : 0;
    if (beta && beta > 0.5 && beta < 2.5) score += 10;
    
    // Revenue growth bonus from Finnhub
    const revGrowth = m['revenueGrowthTTMYoy'];
    if (revGrowth && revGrowth > 0.15) score += 5;
    
  } else if (strategy === 'compounder') {
    if (rangePos < 35) return null;
    if (rsi > 78) return null;
    
    const roe = m['roeTTM'] ? parseFloat(m['roeTTM']) : null;
    const netMargin = m['netProfitMarginTTM'] ? parseFloat(m['netProfitMarginTTM']) : null;
    
    score += Math.min(rangePos * 0.35, 30);
    score += rsi >= 45 && rsi <= 68 ? 15 : 8;
    score += vwapAbove ? 15 : 0;
    score += pctFromHigh >= -15 ? 15 : 8;
    if (beta && beta < 1.2) score += 10;
    if (roe && roe > 15) score += 10;
    if (netMargin && netMargin > 10) score += 5;
    
  } else { // catalyst
    if (!vwapAbove) return null;
    if (rsi < 35 || rsi > 72) return null;
    if (rangePos < 25 || rangePos > 90) return null;
    
    score += 25; // above VWAP base
    score += rsi >= 50 && rsi <= 65 ? 25 : 15;
    score += (100 - Math.abs(rangePos - 60)) * 0.25;
    if (pctFromHigh >= -15) score += 10;
  }

  // Unique offset to prevent ties
  const hash = strategy.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  score += (hash % 100) / 1000;

  return { score: parseFloat(Math.min(score, 100).toFixed(3)), rangePos: parseFloat(rangePos.toFixed(1)), rsi: parseFloat(rsi.toFixed(1)), price };
}

export default async function handler(req) {
  // Verify cron secret
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const today = new Date().toISOString().split('T')[0];
  const results = { date: today, scanned: 0, strategies: {} };

  try {
    // Load universe
    const universe = await sf(TICKER_URL);
    const tickers = universe?.all || [];
    console.log(`[Scan] ${tickers.length} tickers`);

    // Batch process: fetch quote + metric for each ticker
    const allData = {};
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (ticker) => {
        const [quote, metric] = await Promise.all([
          sf(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
          sf(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB}`)
        ]);
        
        if (quote && quote.c > 0) {
          allData[ticker] = { quote, metric };
        }
      }));

      results.scanned = i + batch.length;
      
      // Rate limit: 30 calls per second on Finnhub (5 tickers × 2 calls = 10 calls per batch)
      await new Promise(r => setTimeout(r, 350));
    }

    console.log(`[Scan] ${Object.keys(allData).length} tickers with valid data`);

    // Score per strategy
    const strategies = ['momentum', 'compounder', 'catalyst'];
    
    for (const strategy of strategies) {
      const scored = [];

      for (const [ticker, d] of Object.entries(allData)) {
        const result = scoreStock(d.quote, d.metric, strategy);
        if (result && result.score >= 70) {
          scored.push({ ticker, ...result });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const top100 = scored.slice(0, 100);

      // Clear old candidates and save new
      await sbDelete('pre_screened_candidates', `?strategy_id=eq.${strategy}&trading_date=eq.${today}`);

      for (let i = 0; i < top100.length; i++) {
        const c = top100[i];
        const tier = c.score >= 85 ? 'STRONG_BUY' : c.score >= 80 ? 'BUY' : 'WATCH';
        await sbPost('pre_screened_candidates', {
          strategy_id: strategy,
          ticker: c.ticker,
          rank: i + 1,
          screen_score: c.score,
          screen_reason: `${tier} | Range:${c.rangePos}% RSI:${c.rsi}`,
          price: c.price,
          rsi: c.rsi,
          range_position: c.rangePos,
          trading_date: today
        });
      }

      results.strategies[strategy] = {
        total: scored.length,
        strongBuy: top100.filter(c => c.score >= 85).length,
        top5: top100.slice(0, 5).map(c => `${c.ticker}(${c.score})`)
      };

      console.log(`[${strategy}] ${top100.length} saved. Top 5: ${results.strategies[strategy].top5.join(', ')}`);
    }

    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch(e) {
    console.error('[Scan] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
