export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const zipUrl = 'https://www.sec.gov/files/data/fails-deliver-data/cnsfails202605a.zip';
    const res = await fetch(zipUrl, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Find local file header
    let offset = 0;
    let fileInfo = null;
    
    while (offset < bytes.length - 30) {
      if (bytes[offset]===0x50 && bytes[offset+1]===0x4B && bytes[offset+2]===0x03 && bytes[offset+3]===0x04) {
        const compression = bytes[offset+8] | (bytes[offset+9]<<8);
        const compSize = (bytes[offset+18]) | (bytes[offset+19]<<8) | (bytes[offset+20]<<16) | (bytes[offset+21]<<24);
        const uncompSize = (bytes[offset+22]) | (bytes[offset+23]<<8) | (bytes[offset+24]<<16) | (bytes[offset+25]<<24);
        const nameLen = bytes[offset+26] | (bytes[offset+27]<<8);
        const extraLen = bytes[offset+28] | (bytes[offset+29]<<8);
        const name = new TextDecoder().decode(bytes.slice(offset+30, offset+30+nameLen));
        const dataOffset = offset + 30 + nameLen + extraLen;
        fileInfo = { name, compression, compSize, uncompSize, dataOffset };
        break;
      }
      offset++;
    }

    if (!fileInfo) return new Response(JSON.stringify({ error: 'No local file header found', bytesScanned: offset }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    const compressedData = bytes.slice(fileInfo.dataOffset, fileInfo.dataOffset + fileInfo.compSize);
    
    // Try decompression
    let txtContent = '';
    let decompError = null;
    
    try {
      // For ZIP deflate we need 'deflate-raw' 
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      
      // Write in chunks to avoid memory issues
      const CHUNK = 65536;
      for (let i = 0; i < compressedData.length; i += CHUNK) {
        await writer.write(compressedData.slice(i, i + CHUNK));
      }
      await writer.close();
      
      const chunks = [];
      let totalBytes = 0;
      while (totalBytes < 100000) { // read first 100KB only for test
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }
      reader.cancel();
      
      const combined = new Uint8Array(totalBytes);
      let pos = 0;
      for (const c of chunks) { combined.set(c, pos); pos += c.length; }
      txtContent = new TextDecoder().decode(combined);
    } catch(e) {
      decompError = e.message;
    }

    const lines = txtContent.split('\n').filter(l => l.trim());
    const aaplLines = lines.filter(l => l.includes('|AAPL|') || l.startsWith('AAPL|') || l.includes('|AAPL '));
    
    return new Response(JSON.stringify({
      fileInfo,
      compressedDataLen: compressedData.length,
      decompError,
      txtLength: txtContent.length,
      firstLine: lines[0],
      secondLine: lines[1],
      aaplLines: aaplLines.slice(0,3),
      linesRead: lines.length,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
