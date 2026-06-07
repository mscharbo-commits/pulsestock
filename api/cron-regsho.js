// Daily cron: fetches Reg SHO lists and stores in GitHub Gist
// No Edge Config needed - just set GITHUB_TOKEN env var
export const config = { maxDuration: 60 };

function getLastTradingDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const yr = String(d.getFullYear());
  const mo = String(d.getMonth()+1).padStart(2,'0');
  const dt = String(d.getDate()).padStart(2,'0');
  return { iso: `${yr}-${mo}-${dt}`, yr, mo, dt };
}

async function fetchWithTimeout(url, opts, ms=20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch(e) { clearTimeout(t); throw e; }
}

async function fetchFINRA(date) {
  try {
    const res = await fetchWithTimeout('https://api.finra.org/data/group/otcMarket/name/ThresholdList', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Accept':'application/json','User-Agent':'PulseStock/1.0 research@pulsestock.com'},
      body: JSON.stringify({ limit: 5000, compareFilters: [{compareType:'EQUAL',fieldName:'tradeDate',fieldValue:date.iso}] }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(d => d.issueSymbolIdentifier).filter(Boolean);
  } catch { return []; }
}

async function fetchNasdaq(date) {
  try {
    const res = await fetchWithTimeout(`https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqpla${date.yr}${date.mo}${date.dt}.txt`,
      { headers: {'User-Agent':'PulseStock/1.0 research@pulsestock.com'} });
    if (!res.ok) return [];
    const txt = await res.text();
    return txt.split('\n').filter(l=>l.includes('|Y|')).map(l=>l.split('|')[0]).filter(Boolean);
  } catch { return []; }
}

async function fetchNYSE(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[parseInt(date.mo)-1];
  try {
    const res = await fetchWithTimeout(`https://www.nyse.com/api/regulatory/threshold-securities/download?selectedDate=${date.dt}-${mon}-${date.yr}`,
      { headers: {'User-Agent':'PulseStock/1.0 research@pulsestock.com'} });
    if (!res.ok) return [];
    const txt = await res.text();
    return txt.split('\n').filter(l=>l.includes('|Y|')).map(l=>l.split('|')[0]).filter(Boolean);
  } catch { return []; }
}

async function saveToGist(data) {
  const token = process.env.GITHUB_TOKEN;
  const gistId = process.env.REGSHO_GIST_ID;
  if (!token || !gistId) throw new Error('Missing GITHUB_TOKEN or REGSHO_GIST_ID');
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { 'regsho.json': { content: JSON.stringify(data) } } }),
  });
  if (!res.ok) throw new Error(`Gist update failed: ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: {'Access-Control-Allow-Origin':'*'} });

  const authHeader = req.headers['authorization'] || (req.headers.get && req.headers.get('authorization'));
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const date = getLastTradingDay();
  const [finra, nasdaq, nyse] = await Promise.all([fetchFINRA(date), fetchNasdaq(date), fetchNYSE(date)]);
  const tickers = [...new Set([...finra, ...nasdaq, ...nyse])];

  const data = {
    date: date.iso, tickers,
    counts: { finra: finra.length, nasdaq: nasdaq.length, nyse: nyse.length, total: tickers.length },
    fetchedAt: new Date().toISOString(),
  };

  try {
    await saveToGist(data);
    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { 'Access-Control-Allow-Origin':'*', 'Content-Type': 'application/json' },
    });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message, data }), {
      status: 500, headers: { 'Access-Control-Allow-Origin':'*', 'Content-Type': 'application/json' },
    });
  }
}
