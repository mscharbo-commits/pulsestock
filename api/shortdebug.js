export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const zipUrl = 'https://www.sec.gov/files/data/fails-deliver-data/cnsfails202605a.zip';
    const res = await fetch(zipUrl, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // Find End of Central Directory record (EOCD): PK\x05\x06
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x05 && bytes[i+3]===0x06) {
        eocdOffset = i; break;
      }
    }
    if (eocdOffset < 0) return new Response(JSON.stringify({ error: 'No EOCD found' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    const cdOffset = view.getUint32(eocdOffset + 16, true); // central directory offset
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const numEntries = view.getUint16(eocdOffset + 10, true);

    // Read central directory entries
    let cdPos = cdOffset;
    const entries = [];
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
      entries.push({ name, compMethod, compSize, uncompSize, localOffset });
      cdPos += 46 + nameLen + extraLen + commentLen;
    }

    // Get the txt file entry
    const entry = entries.find(e => e.name.endsWith('.txt'));
    if (!entry) return new Response(JSON.stringify({ error: 'No txt entry', entries }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    // Get actual data offset from local file header
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
      if (totalBytes > 500000) break; // first 500KB
    }
    reader.cancel();

    const combined = new Uint8Array(totalBytes);
    let pos = 0;
    for (const c of chunks) { combined.set(c, pos); pos += c.length; }
    const txt = new TextDecoder().decode(combined);
    const lines = txt.split('\n');
    const aaplLines = lines.filter(l => l.includes('|AAPL|'));

    return new Response(JSON.stringify({
      entry,
      dataStart,
      compDataLen: compData.length,
      txtLength: txt.length,
      firstLine: lines[0],
      aaplLines: aaplLines.slice(0,5),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
