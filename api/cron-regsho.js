// Runs daily at 6 AM ET via Vercel Cron
// Fetches Reg SHO threshold lists from FINRA + Nasdaq + NYSE
// Stores result in Vercel Edge Config for instant reads

export const config = { maxDuration: 60 };

function getLastTradingDay() {
  const d = new Date();
  // Go back until we hit a weekday
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return {
    iso: d.toISOString().slice(0, 10),
    yr:  String(d.getFullYear()),
    mo:  String(d.getMonth() + 1).padStart(2, '0'),
    dt:  String(d.getDate()).padStart(2, '0'),
  };
}

async function fetchFINRA(date) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch('https://api.finra.org/data/group/otcMarket/name/ThresholdList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' },
      body: JSON.stringify({ limit: 5000, compareFilters: [{ compareType: 'EQUAL', fieldName: 'tradeDate', fieldValue: date.iso }] }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(d => d.issueSymbolIdentifier).filter(Boolean);
  } catch { clearTimeout(timer); return []; }
}

async function fetchNasdaq(date) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const url = `https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqpla${date.yr}${date.mo}${date.dt}.txt`;
    const res = await fetch(url, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const txt = await res.text();
    return txt.split('\n').filter(l => l.includes('|Y|')).map(l => l.split('|')[0]).filter(Boolean);
  } catch { clearTimeout(timer); return []; }
}

async function fetchNYSE(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[parseInt(date.mo) - 1];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const url = `https://www.nyse.com/api/regulatory/threshold-securities/download?selectedDate=${date.dt}-${mon}-${date.yr}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const txt = await res.text();
    return txt.split('\n').filter(l => l.includes('|Y|')).map(l => l.split('|')[0]).filter(Boolean);
  } catch { clearTimeout(timer); return []; }
}

async function writeToEdgeConfig(data) {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const vercelApiToken = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!edgeConfigId || !vercelApiToken) throw new Error('Missing EDGE_CONFIG_ID or VERCEL_API_TOKEN env vars');

  const url = `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items${teamId ? '?teamId=' + teamId : ''}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${vercelApiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ operation: 'upsert', key: 'regsho', value: data }]
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Edge Config write failed: ${res.status} ${err}`);
  }
  return res.json();
}

export default async function handler(req) {
  // Verify this is called by Vercel Cron (or manually with secret)
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const date = getLastTradingDay();
  console.log('Fetching Reg SHO for', date.iso);

  const [finra, nasdaq, nyse] = await Promise.all([
    fetchFINRA(date),
    fetchNasdaq(date),
    fetchNYSE(date),
  ]);

  // Merge all three lists, deduplicate
  const allTickers = [...new Set([...finra, ...nasdaq, ...nyse])];
  console.log(`FINRA: ${finra.length}, Nasdaq: ${nasdaq.length}, NYSE: ${nyse.length}, Total unique: ${allTickers.length}`);

  const data = {
    date: date.iso,
    tickers: allTickers,
    counts: { finra: finra.length, nasdaq: nasdaq.length, nyse: nyse.length, total: allTickers.length },
    fetchedAt: new Date().toISOString(),
  };

  try {
    await writeToEdgeConfig(data);
    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Edge Config write error:', err.message);
    // Still return the data even if we couldn't cache it
    return new Response(JSON.stringify({ success: false, error: err.message, data }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
