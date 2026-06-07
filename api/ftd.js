export const config = { maxDuration: 30 };

// Get last N business days (skip weekends)
function getRecentTradeDates(n) {
  const dates = [];
  const d = new Date();
  while (dates.length < n) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // skip Sun/Sat
      const yr = d.getFullYear();
      const mo = String(d.getMonth()+1).padStart(2,'0');
      const dt = String(d.getDate()).padStart(2,'0');
      dates.push({ iso: `${yr}-${mo}-${dt}`, yr, mo, dt });
    }
  }
  return dates;
}

async function checkNasdaqRegSHO(ticker, date) {
  // nasdaqplaYYYYMMDD.txt format
  const url = `https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqpla${date.yr}${date.mo}${date.dt}.txt`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const txt = await res.text();
    const lines = txt.split('\n');
    const match = lines.find(l => l.startsWith(ticker + '|'));
    if (!match) return { onList: false, date: date.iso };
    const parts = match.split('|');
    return { onList: parts[3] === 'Y', date: date.iso, market: parts[2], name: parts[1] };
  } catch { return null; }
}

async function checkNYSERegSHO(ticker, date) {
  // NYSE API: ?selectedDate=DD-Mon-YYYY
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[parseInt(date.mo)-1];
  const selectedDate = `${date.dt}-${mon}-${date.yr}`;
  const url = `https://www.nyse.com/api/regulatory/threshold-securities/download?selectedDate=${selectedDate}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const txt = await res.text();
    const lines = txt.split('\n');
    const match = lines.find(l => l.startsWith(ticker + '|'));
    if (!match) return { onList: false, date: date.iso };
    const parts = match.split('|');
    return { onList: parts[3] === 'Y', date: date.iso, market: parts[2], name: parts[1] };
  } catch { return null; }
}

async function checkFINRARegSHO(ticker, date) {
  // FINRA OTC threshold list API
  const url = 'https://api.finra.org/data/group/otcMarket/name/ThresholdList';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PulseStock/1.0 research@pulsestock.com',
      },
      body: JSON.stringify({
        compareFilters: [
          { compareType: 'EQUAL', fieldName: 'issueSymbolIdentifier', fieldValue: ticker },
          { compareType: 'EQUAL', fieldName: 'tradeDate', fieldValue: date.iso },
        ]
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.length) return { onList: false, date: date.iso };
    const row = data[0];
    return {
      onList: row.regShoThresholdFlag === 'Y' || row.thresholdListFlag === 'Y',
      date: date.iso,
      market: row.marketCategoryDescription,
      name: row.issueName,
      rule4320: row.rule4320Flag === 'Y',
    };
  } catch { return null; }
}

async function getRegSHOHistory(ticker, numDays) {
  const dates = getRecentTradeDates(numDays);
  const results = [];

  // Try all three sources in parallel for the most recent date first
  for (const date of dates) {
    const [nasdaq, nyse, finra] = await Promise.all([
      checkNasdaqRegSHO(ticker, date),
      checkNYSERegSHO(ticker, date),
      checkFINRARegSHO(ticker, date),
    ]);

    const found = nasdaq || nyse || finra;
    if (found) {
      results.push({
        date: date.iso,
        onList: found.onList,
        market: found.market || 'Unknown',
        source: nasdaq ? 'Nasdaq' : nyse ? 'NYSE' : 'FINRA',
      });
    } else {
      // No data for this date (might be holiday or file not yet published)
      results.push({ date: date.iso, onList: false, market: null, source: null });
    }
  }

  return results;
}

function calcSettlementPressureScore(history, shortPct, daysTocover) {
  // Score 0-100 based on:
  // - Consecutive Reg SHO days (0-40 pts): 5+ days = max
  // - Short interest % of float (0-25 pts): >20% = max  
  // - Days to cover (0-20 pts): >10 = max
  // - Recent trend (0-15 pts): increasing consecutive days

  const onListDays = history.filter(h => h.onList);
  const consecutiveDays = (() => {
    let count = 0;
    for (const h of history) {
      if (h.onList) count++;
      else break;
    }
    return count;
  })();

  const regShoScore    = Math.min(40, consecutiveDays * 8);  // 5 days = 40pts
  const shortScore     = Math.min(25, (shortPct || 0) * 1.25); // 20% = 25pts
  const coverScore     = Math.min(20, (daysTocover || 0) * 2); // 10d = 20pts
  const trendScore     = onListDays.length > consecutiveDays ? 10 : 0; // was on list before = pressure building
  const totalScore     = Math.round(regShoScore + shortScore + coverScore + trendScore);

  let level, color;
  if (totalScore >= 70) { level = 'Critical'; color = 'red'; }
  else if (totalScore >= 45) { level = 'Elevated'; color = 'orange'; }
  else if (totalScore >= 20) { level = 'Moderate'; color = 'yellow'; }
  else { level = 'Low'; color = 'green'; }

  return { score: totalScore, level, color, consecutiveDays, onListDays: onListDays.length };
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  let ticker, shortPct, daysTocover;
  try {
    const base = req.url.startsWith('http') ? '' : 'https://x.com';
    const u = new URL(base + req.url);
    ticker      = u.searchParams.get('ticker')?.toUpperCase();
    shortPct    = parseFloat(u.searchParams.get('shortPct') || '0');
    daysTocover = parseFloat(u.searchParams.get('dtc') || '0');
  } catch {
    const qs = (req.url.split('?')[1] || '');
    const p  = Object.fromEntries(qs.split('&').map(x => x.split('=')));
    ticker      = p.ticker?.toUpperCase();
    shortPct    = parseFloat(p.shortPct || '0');
    daysTocover = parseFloat(p.dtc || '0');
  }

  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), {
    status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
  });

  try {
    // Check last 10 trading days for Reg SHO history
    const history = await getRegSHOHistory(ticker, 10);
    const latestOnList = history[0]?.onList || false;
    const sps = calcSettlementPressureScore(history, shortPct, daysTocover);
    const latestDate = history.find(h => h.source)?.date;

    return new Response(JSON.stringify({
      ticker,
      onRegSHO: latestOnList,
      consecutiveDays: sps.consecutiveDays,
      daysOnListLast10: sps.onListDays,
      settlementPressureScore: sps.score,
      pressureLevel: sps.level,
      history: history.slice(0, 10),
      latestDate,
      source: history[0]?.source || 'Multi-exchange',
      note: 'Reg SHO Threshold List — daily, free. Shows persistent settlement failures.',
    }), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 1hr cache
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
