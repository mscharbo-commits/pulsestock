export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function ff(url, opts) {
  try {
    const r = await fetch(url, opts || {});
    if (!r.ok) return { _status: r.status };
    const ct = r.headers.get('content-type')||'';
    if (ct.includes('json')) return await r.json();
    return { _text: (await r.text()).slice(0, 200) };
  } catch(e) { return { _error: e.message }; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const ticker = new URL(req.url).searchParams.get('ticker')?.toUpperCase() || 'AAPL';

  // Get last 3 trading day dates
  const dates = [];
  const d = new Date();
  while (dates.length < 3) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const yr = d.getFullYear();
      const mo = String(d.getMonth()+1).padStart(2,'0');
      const dt = String(d.getDate()).padStart(2,'0');
      dates.push(`${yr}${mo}${dt}`);
    }
  }

  const tests = await Promise.all([
    // FINRA short sale volume - correct URL formats
    ff(`https://www.finra.org/sites/default/files/short-sale-volume-files/CNMSshvol${dates[0]}.txt`)
      .then(d => ['finra_shortvol_consolidated', d._status||d._text?.slice(0,100)||'ok', d._error||'']),
    ff(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${dates[0]}.txt`)
      .then(d => ['finra_cdn', d._status||d._text?.slice(0,80)||'ok', d._error||'']),
    // SEC EDGAR 13F - search for institutional filings
    ff(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=13F-HR&dateRange=custom&startdt=2025-10-01&enddt=2026-06-06&hits.hits.total.value=true&hits.hits._source.period_of_report=true`, {headers:{'User-Agent':'PulseStock research@pulsestock.com'}})
      .then(d => ['sec_13f_search', d._status||(d.hits?`${d.hits.total?.value||0} filings`:'empty'), d._error||'']),
    // SEC EDGAR full text search for 13F
    ff(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=13F-HR&dateRange=custom&startdt=2026-01-01&enddt=2026-06-06`, {headers:{'User-Agent':'PulseStock research@pulsestock.com'}})
      .then(d => ['sec_13f_v2', d._status||(d.hits?'has hits':'empty'), d._error||'']),
    // SEC EDGAR company search
    ff(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=SC+13G`, {headers:{'User-Agent':'PulseStock research@pulsestock.com'}})
      .then(d => ['sec_sc13g', d._status||(d.hits?'has hits':'empty'), d._error||'']),
    // FINRA OTC short vol (different API)
    ff(`https://api.finra.org/data/group/otcMarket/name/weeklySummary?compareFilters=[{"compareType":"EQUAL","fieldName":"issueSymbolIdentifier","fieldValue":"${ticker}"}]&limit=5`)
      .then(d => ['finra_otc_weekly', d._status||(Array.isArray(d)?`${d.length} records`:'obj'), d._error||'']),
    // Quiver free endpoints (no auth)
    ff(`https://api.quiverquant.com/beta/live/congresstrading/${ticker}`)
      .then(d => ['quiver_congress_ticker', d._status||(Array.isArray(d)?`${d.length} trades`:'obj'), d._error||d._text?.slice(0,80)||'']),
    // iborrowdesk full data
    ff(`https://iborrowdesk.com/api/ticker/${ticker}`)
      .then(d => ['iborrowdesk_full', d._status||(d.daily?`${d.daily.length} days`:'obj'), d._error||'']),
    // OpenInsider free JSON API
    ff(`https://openinsider.com/screener?s=${ticker}&o=fdates&cn=20&itype=&bf=1&fd=-1&fdr=&td=0&tdr=&fdlyl=&fdlyh=&daysago=&xp=1&vl=&vh=&ocl=&och=&sic1=-1&sicl=100&sich=9999&iscob=&isceo=&ispres=&isvp=&iscfo=&isgc=&isdirector=&istenpercent=&grp=0&nfl=&nfh=&nil=&nih=&nol=&noh=&v2l=&v2h=&oc2l=&oc2h=&sortcol=0&cnt=20&action=getdata`)
      .then(d => ['openinsider', d._status||(d.data?`${d.data.length} rows`:'empty'), d._error||'']),
  ]);

  const result = {};
  for (const [name, status, detail] of tests) result[name] = {status, detail};
  return new Response(JSON.stringify(result, null, 2), { headers: cors });
}
