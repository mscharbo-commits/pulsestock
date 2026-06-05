export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getFinraShortInterest(ticker) {
  try {
    // Try OTC market endpoint first
    const res = await fetch('https://api.finra.org/data/group/otcMarket/name/EquityShortInterest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        limit: 10,
        compareFilters: [{ compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: ticker.toUpperCase() }],
        sortFields: [{ fieldName: 'settlementDate', sortType: 'DESC' }]
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data) && data.length > 0) return data;
    }
    // Try equity market endpoint for listed stocks
    const res2 = await fetch('https://api.finra.org/data/group/equity/name/equityShortInterest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        limit: 10,
        compareFilters: [{ compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: ticker.toUpperCase() }],
        sortFields: [{ fieldName: 'settlementDate', sortType: 'DESC' }]
      })
    });
    if (!res2.ok) return null;
    const data2 = await res2.json();
    return data2 || null;
  } catch(e) { return null; }
}

async function getFinnhubShortInterest(ticker) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
    // Finnhub uses /stock/social-sentiment for some data and /stock/ownership for short
    // Try the correct short interest endpoint
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/short-interest?symbol=${ticker}&from=${sixMonthsAgo}&to=${today}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Also try to get basic metrics with short ratio
    const metricsRes = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`
    );
    let metrics = null;
    if (metricsRes.ok) {
      const md = await metricsRes.json();
      metrics = md.metric || null;
    }
    return { ...data, metrics };
  } catch(e) { return null; }
}

async function getSecFTD(ticker) {
  try {
    // SEC publishes FTD data as text files bi-monthly
    // We parse the most recent available file
    // Files are at: https://www.sec.gov/data/fails-deliver-data
    // Recent file format: cnsfails{YYYYMM}[a/b].zip
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? year - 1 : year;
    const prevMonthStr = String(prevMonth).padStart(2, '0');

    // Try recent months - SEC lags ~2 weeks so try previous month's second half first
    const attempts = [
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${year}${month}b.zip`,
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${year}${month}a.zip`,
      `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data/cnsfails${prevYear}${prevMonthStr}b.zip`,
    ];

    // We can't parse ZIP files in Edge runtime directly
    // Instead use the SEC EDGAR search approach
    const searchRes = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=%22${ticker.toUpperCase()}%22&forms=SC%2013G%2CSC%2013D&dateRange=custom&startdt=${new Date(Date.now()-90*86400000).toISOString().split('T')[0]}&enddt=${now.toISOString().split('T')[0]}`,
      { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } }
    );

    // For FTD we'll use a pre-processed approach via Fintel-style data
    // The actual SEC files require ZIP parsing not available in Edge runtime
    // Return a structured placeholder that indicates the data source
    return {
      source: 'SEC EDGAR',
      note: 'FTD data published bi-monthly by SEC. Latest available data shown.',
      dataAvailable: false,
      ftdUrl: `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data`,
    };
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
    const [finraData, finnhubData] = await Promise.all([
      getFinraShortInterest(ticker),
      getFinnhubShortInterest(ticker),
    ]);

    // Parse FINRA data
    let shortInterest = null;
    let shortHistory = [];
    if (finraData && Array.isArray(finraData) && finraData.length > 0) {
      const latest = finraData[0];
      shortInterest = {
        settleDate: latest.settlementDate,
        shortShares: latest.currentShortShareNumber,
        prevShortShares: latest.previousShortShareNumber,
        changePercent: latest.changePercent,
        avgShortShares: latest.averageShortShareNumber,
        marketCode: latest.marketCategoryCode,
        source: 'FINRA',
      };
      shortHistory = finraData.slice(0, 6).map(d => ({
        date: d.settlementDate,
        shares: d.currentShortShareNumber,
        change: d.changePercent,
      }));
    }

    // Parse Finnhub data
    let finnhubShort = null;
    if (finnhubData) {
      const m = finnhubData.metrics || {};
      // Try data array first, fall back to metrics
      if (finnhubData.data && finnhubData.data.length > 0) {
        const latest = finnhubData.data[finnhubData.data.length - 1];
        finnhubShort = {
          date: latest.date,
          shortInterest: latest.shortInterest,
          daysTocover: latest.daysToCover,
          shortPercent: latest.shortPercent,
          source: 'Finnhub',
        };
      } else if (m['10DayAverageTradingVolume'] || m.shortInterest) {
        finnhubShort = {
          date: new Date().toISOString().split('T')[0],
          shortInterest: m.shortInterest || null,
          daysTocover: m.shortRatio || null,
          shortPercent: m.shortPercentOutstandingFloat || m.shortPercentOutstanding || null,
          source: 'Finnhub Metrics',
        };
      }
    }

    return new Response(JSON.stringify({
      ticker: ticker.toUpperCase(),
      shortInterest,
      finnhubShort,
      shortHistory,
      ftd: {
        note: 'SEC FTD data published bi-monthly. View raw data below.',
        ftdUrl: `https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data`,
        fintelUrl: `https://fintel.io/fails-to-deliver/${ticker.toUpperCase()}`,
        lastUpdated: new Date().toISOString(),
      },
      sources: {
        shortInterest: 'FINRA Rule 4560 — bi-monthly publication',
        ftd: 'SEC EDGAR — bi-monthly publication (~2 week lag)',
      }
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
