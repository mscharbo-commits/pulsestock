export const config = { runtime: 'edge' };

async function scrapeMarketBeat(ticker) {
  // Try NASDAQ first, then NYSE
  const exchanges = ['NASDAQ', 'NYSE', 'NYSEARCA', 'OTC'];
  for (const exch of exchanges) {
    try {
      const url = `https://www.marketbeat.com/stocks/${exch}/${ticker.toUpperCase()}/short-interest/`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.marketbeat.com/',
          'Cache-Control': 'no-cache',
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes('Short Interest')) continue;

      // Parse the data table - matching what we see in the screenshot
      const parse = (pattern) => {
        const m = html.match(pattern);
        return m ? m[1].trim() : null;
      };

      // Current Short Interest shares
      const sharesMatch = html.match(/Current Short Interest<\/td>[\s\S]*?<td[^>]*>([\d,]+)\s*shares/i)
        || html.match(/Current Short Interest[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d,]+)/i);

      // Short Percent of Float
      const pctMatch = html.match(/Short Percent of Float<\/td>[\s\S]*?<td[^>]*>([\d.]+)%/i)
        || html.match(/Short Percent of Float[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d.]+)%/i);

      // Days to Cover / Short Interest Ratio
      const daysMatch = html.match(/Short Interest Ratio<\/td>[\s\S]*?<td[^>]*>([\d.]+)\s*Days/i)
        || html.match(/Days to Cover[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d.]+)/i)
        || html.match(/Short Interest Ratio[^<]*<\/td>[\s\S]{0,200}?([\d.]+)\s*Days/i);

      // Change vs prior
      const changeMatch = html.match(/Change Vs\.? Previous[^<]*<\/td>[\s\S]*?<td[^>]*>([+-]?[\d.]+)%/i)
        || html.match(/Change Vs[^<]*<\/td>[\s\S]{0,300}?([+-]?[\d.]+)%/i);

      // Last Record Date
      const dateMatch = html.match(/Last Record Date<\/td>[\s\S]*?<td[^>]*>([^<]+)/i)
        || html.match(/Settlement Date[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([^<]+)/i);

      // Previous short interest
      const prevMatch = html.match(/Previous Short Interest<\/td>[\s\S]*?<td[^>]*>([\d,]+)\s*shares/i)
        || html.match(/Previous Short Interest[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d,]+)/i);

      // Outstanding shares  
      const outstandingMatch = html.match(/Outstanding Shares<\/td>[\s\S]*?<td[^>]*>([\d,]+)\s*shares/i)
        || html.match(/Outstanding Shares[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d,]+)/i);

      // Avg trading volume
      const avgVolMatch = html.match(/Average Trading Volume<\/td>[\s\S]*?<td[^>]*>([\d,]+)\s*shares/i)
        || html.match(/Average Trading Volume[^<]*<\/td>[\s\S]{0,200}?<td[^>]*>([\d,]+)/i);

      const shortShares = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g,'')) : null;
      const prevShares = prevMatch ? parseInt(prevMatch[1].replace(/,/g,'')) : null;

      if (!shortShares && !pctMatch) continue; // No useful data found

      // Build short history from current + previous
      const shortHistory = [];
      if (shortShares && dateMatch) shortHistory.push({ date: dateMatch[1]?.trim(), shares: shortShares });
      if (prevShares) shortHistory.push({ date: 'Prior period', shares: prevShares });

      return {
        shortShares,
        shortPercent: pctMatch ? parseFloat(pctMatch[1]) : null,
        daysTocover: daysMatch ? parseFloat(daysMatch[1]) : null,
        settleDate: dateMatch ? dateMatch[1]?.trim() : null,
        changePercent: changeMatch ? changeMatch[1] : null,
        prevShortShares: prevShares,
        outstandingShares: outstandingMatch ? parseInt(outstandingMatch[1].replace(/,/g,'')) : null,
        avgVolume: avgVolMatch ? parseInt(avgVolMatch[1].replace(/,/g,'')) : null,
        source: 'MarketBeat / FINRA',
        exchange: exch,
        shortHistory,
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
        compareFilters: [{ compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: ticker.toUpperCase() }],
        sortFields: [{ fieldName: 'settlementDate', sortType: 'DESC' }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch(e) { return null; }
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const t = ticker.toUpperCase();

  try {
    const [mbData, finraOTC] = await Promise.all([
      scrapeMarketBeat(t),
      getFinraOTC(t),
    ]);

    let result = {
      ticker: t,
      shortShares: null, shortPercent: null, daysTocover: null,
      settleDate: null, changePercent: null, source: null,
      prevShortShares: null, outstandingShares: null, avgVolume: null,
      shortHistory: [],
      ftd: {
        ftdUrl: 'https://www.sec.gov/data/foiadocsfailsdatahtm',
        fintelUrl: `https://fintel.io/fails-to-deliver/${t}`,
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${t}/short-interest/`,
      }
    };

    if (mbData) {
      Object.assign(result, mbData);
    } else if (finraOTC && finraOTC.length > 0) {
      const latest = finraOTC[0];
      result.shortShares = latest.currentShortShareNumber;
      result.settleDate = latest.settlementDate;
      result.changePercent = latest.changePercent;
      result.source = 'FINRA OTC';
      result.shortHistory = finraOTC.slice(0,6).map(d => ({
        date: d.settlementDate,
        shares: d.currentShortShareNumber,
        change: d.changePercent,
      }));
    }

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
