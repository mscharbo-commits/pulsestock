export const config = { maxDuration: 20 };

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  
  // Get last 3 trading days
  const dates = [];
  const d = new Date();
  while(dates.length < 3) {
    d.setDate(d.getDate()-1);
    if(d.getDay()!==0 && d.getDay()!==6) {
      const yr=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,'0'), dt=String(d.getDate()).padStart(2,'0');
      dates.push(`${yr}-${mo}-${dt}`);
    }
  }

  const results = {};
  
  // Try FINRA - get ALL stocks on the list for the most recent date
  for(const date of dates) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://api.finra.org/data/group/otcMarket/name/ThresholdList', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Accept':'application/json','User-Agent':'PulseStock/1.0'},
        body: JSON.stringify({ limit: 100, compareFilters: [{compareType:'EQUAL', fieldName:'tradeDate', fieldValue: date}] }),
        signal: ctrl.signal,
      });
      if(res.ok) {
        const data = await res.json();
        results[date] = { count: data.length, tickers: data.slice(0,30).map(d=>d.issueSymbolIdentifier) };
        break;
      } else {
        results[date] = { error: res.status };
      }
    } catch(e) { results[date] = { error: e.message }; }
  }

  // Try Nasdaq threshold list
  for(const date of dates) {
    try {
      const [yr,mo,dt] = date.split('-');
      const url = `https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqpla${yr}${mo}${dt}.txt`;
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { headers:{'User-Agent':'PulseStock/1.0'}, signal: ctrl.signal });
      if(res.ok) {
        const txt = await res.text();
        const onList = txt.split('\n').filter(l=>l.includes('|Y|')).map(l=>l.split('|')[0]);
        results['nasdaq_'+date] = { count: onList.length, tickers: onList.slice(0,30) };
        break;
      } else {
        results['nasdaq_'+date] = { error: res.status };
      }
    } catch(e) { results['nasdaq_'+date] = { error: e.message }; }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}
