export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

// SEC FTD files are pipe-delimited text inside ZIP files
// We fetch the index page to find latest file URLs
async function getSecFTDIndex() {
  try {
    const res = await fetch('https://www.sec.gov/data/foiadocsfailsdatahtm', {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Find all cnsfails links
    const matches = [...html.matchAll(/href="([^"]*cnsfails\d{6}[ab]\.zip)"/gi)];
    return matches.map(m => 'https://www.sec.gov' + m[1]).slice(0, 4);
  } catch(e) { return null; }
}

async function getFinnhubQuote(ticker) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return d;
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

async function getFinraEquity(ticker) {
  try {
    // FINRA equity short interest (for listed stocks)
    const res = await fetch(`https://api.finra.org/data/group/equity/name/equityShortInterest?compareFilters=[{"compareType":"equal","fieldName":"symbolCode","fieldValue":"${ticker.toUpperCase()}"}]&limit=6&sortFields=[{"fieldName":"settlementDate","sortType":"DESC"}]`, {
      headers: { 'Accept': 'application/json' }
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
    const [finraOTC, finraEquity, ftdIndex] = await Promise.all([
      getFinraOTC(t),
      getFinraEquity(t),
      getSecFTDIndex(),
    ]);

    let shortShares = null, shortPercent = null, daysTocover = null;
    let settleDate = null, changePercent = null, source = null;
    let shortHistory = [];

    // Parse FINRA OTC data
    if (finraOTC && finraOTC.length > 0) {
      const latest = finraOTC[0];
      shortShares = latest.currentShortShareNumber || latest.shortInterestQuantity;
      settleDate = latest.settlementDate;
      changePercent = latest.changePercent;
      source = 'FINRA OTC';
      shortHistory = finraOTC.slice(0,6).map(d => ({
        date: d.settlementDate,
        shares: d.currentShortShareNumber || d.shortInterestQuantity,
        change: d.changePercent,
      }));
    }

    // Parse FINRA equity data (for listed stocks)
    if (!shortShares && finraEquity && finraEquity.length > 0) {
      const latest = finraEquity[0];
      shortShares = latest.currentShortInterestQuantity || latest.shortInterestQuantity || latest.currentShortShareNumber;
      settleDate = latest.settlementDate;
      changePercent = latest.percentChangeFromPriorSettlementDate || latest.changePercent;
      shortPercent = latest.shortInterestPercentOfFloat || latest.percentOfFloatShortInterest;
      daysTocover = latest.daysToCoverShortInterest || latest.averageDailyShareVolume ? 
        (shortShares / latest.averageDailyShareVolume).toFixed(1) : null;
      source = 'FINRA';
      shortHistory = finraEquity.slice(0,6).map(d => ({
        date: d.settlementDate,
        shares: d.currentShortInterestQuantity || d.shortInterestQuantity,
        change: d.percentChangeFromPriorSettlementDate,
      }));
    }

    // Get latest FTD files list
    const ftdFiles = ftdIndex || [];
    const latestFtdFile = ftdFiles[0] || null;

    return new Response(JSON.stringify({
      ticker: t,
      shortShares,
      shortPercent: shortPercent ? parseFloat(shortPercent) : null,
      daysTocover: daysTocover ? parseFloat(daysTocover) : null,
      settleDate,
      changePercent,
      source,
      shortHistory,
      ftd: {
        note: 'SEC FTD data published bi-monthly (~2 week lag)',
        ftdUrl: 'https://www.sec.gov/data/foiadocsfailsdatahtm',
        latestFile: latestFtdFile,
        fintelUrl: `https://fintel.io/fails-to-deliver/${t}`,
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${t}/short-interest/`,
        chartmillUrl: `https://www.chartmill.com/stock/quote/${t}/short-interest`,
      },
      debug: {
        finraOTCFound: !!finraOTC,
        finraEquityFound: !!finraEquity,
        ftdFilesFound: ftdFiles.length,
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
