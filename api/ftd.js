export const config = { maxDuration: 60 };

async function getSecFTD(ticker) {
  const now = new Date();
  const files = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now - i * 30 * 86400000);
    const yr = d.getFullYear();
    const mo = String(d.getMonth()+1).padStart(2,'0');
    files.push(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yr}${mo}b.zip`);
    files.push(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yr}${mo}a.zip`);
  }

  for (const zipUrl of files) {
    try {
      const res = await fetch(zipUrl, { 
        headers: { 'User-Agent': 'PulseStock research@pulsestock.com' },
      });
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
        const compSize = view.getUint32(cdPos+20, true);
        const nameLen = view.getUint16(cdPos+28, true);
        const extraLen = view.getUint16(cdPos+30, true);
        const commentLen = view.getUint16(cdPos+32, true);
        const localOffset = view.getUint32(cdPos+42, true);
        const name = new TextDecoder().decode(bytes.slice(cdPos+46, cdPos+46+nameLen));
        if (name.endsWith('.txt')) { entry = { compSize, localOffset, name }; break; }
        cdPos += 46 + nameLen + extraLen + commentLen;
      }
      if (!entry) continue;

      const lNameLen = view.getUint16(entry.localOffset+26, true);
      const lExtraLen = view.getUint16(entry.localOffset+28, true);
      const dataStart = entry.localOffset + 30 + lNameLen + lExtraLen;
      const compData = bytes.slice(dataStart, dataStart + entry.compSize);

      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compData);
      writer.close();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      reader.cancel();
      const combined = new Uint8Array(chunks.reduce((a,c)=>a+c.length,0));
      let pos = 0;
      for (const c of chunks) { combined.set(c, pos); pos += c.length; }
      const txt = new TextDecoder().decode(combined);

      const tickerLines = txt.split('\n').filter(l => l.split('|')[2] === ticker);
      if (tickerLines.length === 0) continue;

      const ftdData = tickerLines.map(l => {
        const [date, cusip, sym, qty, desc, price] = l.split('|');
        return {
          date: date ? `${date.substring(0,4)}-${date.substring(4,6)}-${date.substring(6,8)}` : null,
          quantity: qty ? parseInt(qty) : 0,
          price: price ? parseFloat(price) : null,
        };
      }).filter(d => d.date && d.quantity > 0);

      const totalFTD = ftdData.reduce((a,b) => a + b.quantity, 0);
      const latestFTD = ftdData[ftdData.length-1];
      const maxFTD = Math.max(...ftdData.map(d => d.quantity));
      const fileMatch = zipUrl.match(/cnsfails(\d{4})(\d{2})(a|b)\.zip/);
      const period = fileMatch ? `${fileMatch[1]}-${fileMatch[2]} ${fileMatch[3]==='a'?'1st half':'2nd half'}` : null;

      return { totalFTD, latestFTD: latestFTD?.quantity||0, maxFTD, latestDate: latestFTD?.date, latestPrice: latestFTD?.price, period, dailyData: ftdData, source: 'SEC EDGAR', zipFile: zipUrl.split('/').pop() };
    } catch(e) { continue; }
  }
  return null;
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const data = await getSecFTD(ticker);
    return new Response(JSON.stringify(data || { error: 'No FTD data found', ticker }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=43200' } // 12hr cache
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
