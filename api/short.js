export const config = { runtime: 'edge' };

const MASSIVE_KEY = '3495_3DnKOgUI1UI9OI57JRBRD8Ghg2c';
const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getMassiveShortInterest(ticker) {
  try {
    // Massive short interest endpoint (FINRA bi-weekly data)
    const res = await fetch(
      `https://api.massive.com/v3/stocks/${ticker.toUpperCase()}/short-interest?limit=6&order=desc&apiKey=${MASSIVE_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || null;
  } catch(e) { return null; }
}

async function getMassiveShortVolume(ticker) {
  try {
    // Massive short volume endpoint (daily)
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const res = await fetch(
      `https://api.massive.com/v3/stocks/${ticker.toUpperCase()}/short-volume?from=${weekAgo}&to=${today}&limit=5&order=desc&apiKey=${MASSIVE_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || null;
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
    const [massiveShort, massiveVol, finraData] = await Promise.all([
      getMassiveShortInterest(ticker),
      getMassiveShortVolume(ticker),
      getFinraOTC(ticker),
    ]);

    let shortShares = null, shortPercent = null, daysTocover = null;
    let settleDate = null, changePercent = null, source = null;
    let shortHistory = [];
    let shortVolume = null, shortVolumeRatio = null;

    // Parse Massive short interest (primary source)
    if (massiveShort && massiveShort.length > 0) {
      const latest = massiveShort[0];
      const prev = massiveShort[1];
      shortShares = latest.short_interest;
      shortPercent = latest.short_percent_float ? parseFloat(latest.short_percent_float) * 100 : null;
      daysTocover = latest.days_to_cover ? parseFloat(latest.days_to_cover) : null;
      settleDate = latest.settlement_date;
      source = 'FINRA via Massive';
      if (prev && prev.short_interest && latest.short_interest) {
        changePercent = ((latest.short_interest - prev.short_interest) / prev.short_interest * 100).toFixed(2);
      }
      shortHistory = massiveShort.slice(0, 6).map(d => ({
        date: d.settlement_date,
        shares: d.short_interest,
        percent: d.short_percent_float ? (parseFloat(d.short_percent_float)*100).toFixed(2) : null,
      }));
    }

    // Parse Massive short volume (supplement)
    if (massiveVol && massiveVol.length > 0) {
      const latest = massiveVol[0];
      shortVolume = latest.short_volume;
      shortVolumeRatio = latest.short_volume_ratio
        ? parseFloat(latest.short_volume_ratio * 100).toFixed(1)
        : (latest.short_volume && latest.total_volume
            ? (latest.short_volume / latest.total_volume * 100).toFixed(1)
            : null);
    }

    // Fallback to FINRA OTC for pink/OTC stocks
    if (!shortShares && finraData && finraData.length > 0) {
      const latest = finraData[0];
      const prev = finraData[1];
      shortShares = latest.currentShortShareNumber;
      settleDate = latest.settlementDate;
      changePercent = latest.changePercent;
      source = 'FINRA OTC';
      shortHistory = finraData.slice(0,6).map(d => ({
        date: d.settlementDate,
        shares: d.currentShortShareNumber,
        change: d.changePercent,
      }));
    }

    return new Response(JSON.stringify({
      ticker: ticker.toUpperCase(),
      shortShares,
      shortPercent,
      daysTocover,
      settleDate,
      changePercent,
      shortVolume,
      shortVolumeRatio,
      source,
      shortHistory,
      ftd: {
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
