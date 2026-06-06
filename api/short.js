export const config = { runtime: 'edge' };

async function scrapeMarketBeat(ticker) {
  const exchanges = ['NASDAQ', 'NYSE', 'NYSEARCA', 'OTC'];
  for (const exch of exchanges) {
    try {
      const res = await fetch(`https://www.marketbeat.com/stocks/${exch}/${ticker}/short-interest/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'Accept': 'text/html' }
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes('Current Short Interest')) continue;
      const get = (label) => { const re = new RegExp('<dt>' + label + '<\/dt><dd[^>]*>([^<]+)<\/dd>', 'i'); const m = html.match(re); return m ? m[1].trim() : null; };
      const getSpan = (label) => { const re = new RegExp('<dt>' + label + '<\/dt><dd[^>]*><span[^>]*>([^<]+)<\/span><\/dd>', 'i'); const m = html.match(re); return m ? m[1].trim() : null; };
      const parseShares = (s) => s ? parseInt(s.replace(/[^0-9]/g,'')) : null;
      const currentRaw = get('Current Short Interest');
      const shortShares = parseShares(currentRaw);
      if (!shortShares) continue;
      return {
        shortShares,
        prevShortShares: parseShares(get('Previous Short Interest')),
        changePercent: (getSpan('Change Vs\. Previous Month') || get('Change Vs\. Previous Month') || '').replace('%','') || null,
        daysTocover: get('Short Interest Ratio') ? parseFloat(get('Short Interest Ratio')) : null,
        settleDate: get('Last Record Date'),
        outstandingShares: parseShares(get('Outstanding Shares')),
        shortPercent: get('Short Percent of Float') ? parseFloat(get('Short Percent of Float')) : null,
        avgVolume: parseShares(get('Average Trading Volume')),
        source: 'MarketBeat / FINRA',
        exchange: exch,
      };
    } catch(e) { continue; }
  }
  return null;
}

async function getSecFTD(ticker) {
  // Try last 3 SEC FTD files (most recent first)
  const now = new Date();
  const files = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now - i * 30 * 86400000);
    const yr = d.getFullYear();
    const mo = String(d.getMonth()+1).padStart(2,'0');
    files.push(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yr}${mo}b.zip`);
    files.push(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yr}${mo}a.zip`);
  }

  for (const zipUrl of files) {
    try {
      const res = await fetch(zipUrl, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const view = new DataView(arrayBuffer);

      // Find EOCD
      let eocdOffset = -1;
      for (let i = bytes.length - 22; i >= 0; i--) {
        if (bytes[i]===0x50&&bytes[i+1]===0x4B&&bytes[i+2]===0x05&&bytes[i+3]===0x06) { eocdOffset=i; break; }
      }
      if (eocdOffset < 0) continue;

      const cdOffset = view.getUint32(eocdOffset+16, true);
      const numEntries = view.getUint16(eocdOffset+10, true);
      let cdPos = cdOffset;
      let entry = null;
      for (let i = 0; i < numEntries; i++) {
        if (bytes[cdPos]!==0x50||bytes[cdPos+1]!==0x4B||bytes[cdPos+2]!==0x01||bytes[cdPos+3]!==0x02) break;
        const compMethod = view.getUint16(cdPos+10, true);
        const compSize = view.getUint32(cdPos+20, true);
        const uncompSize = view.getUint32(cdPos+24, true);
        const nameLen = view.getUint16(cdPos+28, true);
        const extraLen = view.getUint16(cdPos+30, true);
        const commentLen = view.getUint16(cdPos+32, true);
        const localOffset = view.getUint32(cdPos+42, true);
        const name = new TextDecoder().decode(bytes.slice(cdPos+46, cdPos+46+nameLen));
        if (name.endsWith('.txt')) { entry = { compMethod, compSize, uncompSize, localOffset, name }; break; }
        cdPos += 46 + nameLen + extraLen + commentLen;
      }
      if (!entry) continue;

      const lNameLen = view.getUint16(entry.localOffset+26, true);
      const lExtraLen = view.getUint16(entry.localOffset+28, true);
      const dataStart = entry.localOffset + 30 + lNameLen + lExtraLen;
      const compData = bytes.slice(dataStart, dataStart + entry.compSize);

      // Decompress
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compData);
      writer.close();
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }
      reader.cancel();
      const combined = new Uint8Array(totalBytes);
      let pos = 0;
      for (const c of chunks) { combined.set(c, pos); pos += c.length; }
      const txt = new TextDecoder().decode(combined);

      // Parse lines for this ticker
      // Format: SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE
      const tickerLines = txt.split('\n').filter(l => {
        const parts = l.split('|');
        return parts[2] === ticker;
      });

      if (tickerLines.length === 0) continue;

      // Aggregate FTD data
      const ftdData = tickerLines.map(l => {
        const [date, cusip, sym, qty, desc, price] = l.split('|');
        return {
          date: date ? date.substring(0,4)+'-'+date.substring(4,6)+'-'+date.substring(6,8) : null,
          quantity: qty ? parseInt(qty) : 0,
          price: price ? parseFloat(price) : null,
        };
      }).filter(d => d.date);

      // Sum total FTD for the period
      const totalFTD = ftdData.reduce((a,b) => a + b.quantity, 0);
      const latestFTD = ftdData[ftdData.length-1];
      const maxFTD = Math.max(...ftdData.map(d => d.quantity));

      // Extract period from filename e.g. cnsfails202605a -> May 2026 first half
      const fileMatch = zipUrl.match(/cnsfails(\d{4})(\d{2})(a|b)\.zip/);
      const period = fileMatch ? `${fileMatch[1]}-${fileMatch[2]} ${fileMatch[3]==='a'?'1st half':'2nd half'}` : null;

      return {
        totalFTD,
        latestFTD: latestFTD?.quantity || 0,
        maxFTD,
        latestDate: latestFTD?.date,
        latestPrice: latestFTD?.price,
        period,
        dailyData: ftdData.slice(-10),
        source: 'SEC EDGAR',
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
      body: JSON.stringify({ limit: 6, compareFilters: [{ compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: ticker }], sortFields: [{ fieldName: 'settlementDate', sortType: 'DESC' }] })
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
    // Run MarketBeat + FINRA in parallel, FTD separately with timeout
    const [mbData, finraOTC] = await Promise.all([
      scrapeMarketBeat(ticker),
      getFinraOTC(ticker),
    ]);
    
    // FTD with its own timeout - if it takes too long return without it
    let ftdData = null;
    const ftdUrl = url.searchParams.get('ftd') === '1';
    if (ftdUrl) {
      // Only fetch FTD when explicitly requested via ?ftd=1
      ftdData = await getSecFTD(ticker);
    }

    let result = {
      ticker,
      shortShares: null, shortPercent: null, daysTocover: null,
      settleDate: null, changePercent: null, source: null,
      prevShortShares: null, outstandingShares: null, avgVolume: null,
      shortHistory: [],
      ftd: ftdData ? {
        totalFTD: ftdData.totalFTD,
        latestFTD: ftdData.latestFTD,
        maxFTD: ftdData.maxFTD,
        latestDate: ftdData.latestDate,
        latestPrice: ftdData.latestPrice,
        period: ftdData.period,
        dailyData: ftdData.dailyData,
        source: ftdData.source,
        ftdUrl: 'https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data',
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${ticker}/short-interest/`,
      } : {
        ftdUrl: 'https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data',
        marketbeatUrl: `https://www.marketbeat.com/stocks/NASDAQ/${ticker}/short-interest/`,
      }
    };

    if (mbData) {
      Object.assign(result, mbData);
      result.shortHistory = [
        ...(mbData.settleDate ? [{ date: mbData.settleDate, shares: mbData.shortShares }] : []),
        ...(mbData.prevShortShares ? [{ date: 'Prior period', shares: mbData.prevShortShares }] : []),
      ];
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
