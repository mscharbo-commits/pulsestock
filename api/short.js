export const config = { runtime: 'edge' };

async function scrapeMarketBeat(ticker) {
  const exchanges = ['NASDAQ', 'NYSE', 'NYSEARCA', 'OTC'];
  for (const exch of exchanges) {
    try {
      const res = await fetch(`https://www.marketbeat.com/stocks/${exch}/${ticker}/short-interest/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
          'Accept': 'text/html',
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes('Current Short Interest')) continue;

      // Exact patterns matching the HTML structure we found:
      // <dt>Current Short Interest</dt><dd class="text-right">138,782,718 shares</dd>
      const get = (label) => {
        const re = new RegExp('<dt>' + label + '<\\/dt><dd[^>]*>([^<]+)<\\/dd>', 'i');
        const m = html.match(re);
        return m ? m[1].trim() : null;
      };

      const getSpan = (label) => {
        const re = new RegExp('<dt>' + label + '<\\/dt><dd[^>]*><span[^>]*>([^<]+)<\\/span><\\/dd>', 'i');
        const m = html.match(re);
        return m ? m[1].trim() : null;
      };

      const currentRaw = get('Current Short Interest');
      const previousRaw = get('Previous Short Interest');
      const changeRaw = getSpan('Change Vs\\. Previous Month') || get('Change Vs\\. Previous Month');
      const ratioRaw = get('Short Interest Ratio');
      const dateRaw = get('Last Record Date');
      const outstandingRaw = get('Outstanding Shares');
      const floatPctRaw = get('Short Percent of Float');
      const avgVolRaw = get('Average Trading Volume');

      const parseShares = (s) => s ? parseInt(s.replace(/[^0-9]/g,'')) : null;
      const parsePct = (s) => s ? parseFloat(s.replace('%','')) : null;
      const parseDays = (s) => s ? parseFloat(s) : null;

      const shortShares = parseShares(currentRaw);
      if (!shortShares) continue;

      return {
        shortShares,
        prevShortShares: parseShares(previousRaw),
        changePercent: changeRaw ? changeRaw.replace('%','') : null,
        daysTocover: ratioRaw ? parseDays(ratioRaw) : null,
        settleDate: dateRaw,
        outstandingShares: parseShares(outstandingRaw),
        shortPercent: floatPctRaw ? parsePct(floatPctRaw) : null,
        avgVolume: parseShares(avgVolRaw),
        source: 'MarketBeat / FINRA',
        exchange: exch,
      };
    } catch(e) { continue; }
  }
  return null;
}

async function getFinraOTC(ticker) {
  try {
    const res = await fetch('https://api.finra.org/data/group/otcMarket/name/EquityShortInterest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        limit: 6,
        compareFilters: [{ compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: ticker }],
        sortFields: [{ fieldName: 'settlementDate', sortType: 'DESC' }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch(e) { return null; }
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const [mbData, finraOTC] = await Promise.all([scrapeMarketBeat(ticker), getFinraOTC(ticker)]);

    let result = {
      ticker,
      shortShares: null, shortPercent: null, daysTocover: null,
      settleDate: null, changePercent: null, source: null,
      prevShortShares: null, outstandingShares: null, avgVolume: null,
      shortHistory: [],
      ftd: {
        ftdUrl: 'https://www.sec.gov/data/foiadocsfailsdatahtm',
        fintelUrl: `https://fintel.io/fails-to-deliver/${ticker}`,
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${ticker}/short-interest/`,
      }
    };

    if (mbData) {
      Object.assign(result, mbData);
      if (mbData.shortShares && mbData.prevShortShares) {
        result.shortHistory = [
          { date: mbData.settleDate, shares: mbData.shortShares },
          { date: 'Prior period', shares: mbData.prevShortShares },
        ];
      }
    } else if (finraOTC) {
      const l = finraOTC[0];
      result.shortShares = l.currentShortShareNumber;
      result.settleDate = l.settlementDate;
      result.changePercent = l.changePercent;
      result.source = 'FINRA OTC';
      result.shortHistory = finraOTC.slice(0,6).map(d => ({ date: d.settlementDate, shares: d.currentShortShareNumber }));
    }

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
