export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getFinnhubMetrics(ticker) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.metric || null;
  } catch(e) { return null; }
}

async function getMarketBeatShort(ticker) {
  try {
    // MarketBeat publishes short interest data publicly
    const res = await fetch(
      `https://www.marketbeat.com/stocks/NASDAQ/${ticker}/short-interest/`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html' } }
    );
    if (!res.ok) return null;
    const html = await res.text();

    // Parse key metrics from the page
    const shortSharesMatch = html.match(/Short Interest<\/td>\s*<td[^>]*>([\d,]+)\s*shares/i);
    const shortPctMatch = html.match(/Percent of Float<\/td>\s*<td[^>]*>([\d.]+)%/i);
    const daysCoverMatch = html.match(/Short Interest Ratio[^<]*<\/td>\s*<td[^>]*>([\d.]+)/i);
    const settleDateMatch = html.match(/Last Record Date<\/td>\s*<td[^>]*>([^<]+)</i);

    if (!shortSharesMatch && !shortPctMatch) return null;

    return {
      shortShares: shortSharesMatch ? parseInt(shortSharesMatch[1].replace(/,/g,'')) : null,
      shortPercent: shortPctMatch ? parseFloat(shortPctMatch[1]) : null,
      daysTocover: daysCoverMatch ? parseFloat(daysCoverMatch[1]) : null,
      settleDate: settleDateMatch ? settleDateMatch[1].trim() : null,
      source: 'MarketBeat',
    };
  } catch(e) { return null; }
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

  try {
    const [metrics, finraData, mbData] = await Promise.all([
      getFinnhubMetrics(ticker),
      getFinraOTC(ticker),
      getMarketBeatShort(ticker),
    ]);

    let shortShares = null, shortPercent = null, daysTocover = null, settleDate = null, changePercent = null, source = null;

    // Priority: MarketBeat > FINRA > Finnhub metrics
    if (mbData && (mbData.shortShares || mbData.shortPercent)) {
      shortShares = mbData.shortShares;
      shortPercent = mbData.shortPercent;
      daysTocover = mbData.daysTocover;
      settleDate = mbData.settleDate;
      source = 'MarketBeat / FINRA';
    } else if (finraData) {
      const latest = finraData[0];
      shortShares = latest.currentShortShareNumber;
      changePercent = latest.changePercent;
      settleDate = latest.settlementDate;
      source = 'FINRA';
    } else if (metrics) {
      // Finnhub metrics - has basic short data on paid plan, may be null on free
      shortPercent = metrics.shortPercentOutstandingFloat || metrics.shortPercentOutstanding || null;
      daysTocover = metrics.shortRatio || null;
      source = shortPercent ? 'Finnhub' : null;
    }

    // Short history from FINRA if available
    const shortHistory = finraData ? finraData.slice(0, 6).map(d => ({
      date: d.settlementDate,
      shares: d.currentShortShareNumber,
      change: d.changePercent,
    })) : [];

    return new Response(JSON.stringify({
      ticker: ticker.toUpperCase(),
      shortShares,
      shortPercent,
      daysTocover,
      settleDate,
      changePercent,
      source,
      shortHistory,
      ftd: {
        note: 'SEC FTD data published bi-monthly. View raw data below.',
        ftdUrl: 'https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data',
        fintelUrl: `https://fintel.io/fails-to-deliver/${ticker.toUpperCase()}`,
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${ticker.toUpperCase()}/short-interest/`,
      },
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
