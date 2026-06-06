export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    // Fetch the ZIP file
    const zipUrl = 'https://www.sec.gov/files/data/fails-deliver-data/cnsfails202605a.zip';
    const res = await fetch(zipUrl, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // ZIP local file header magic: PK\x03\x04
    // Find the first local file entry and extract compressed data
    // ZIP format: signature(4) + version(2) + flags(2) + compression(2) + modtime(2) + moddate(2) 
    //             + crc32(4) + compsize(4) + uncompsize(4) + namelen(2) + extralen(2) + name + extra + data
    
    let offset = 0;
    let txtContent = null;
    
    while (offset < bytes.length - 4) {
      // Check for local file header signature
      if (bytes[offset] === 0x50 && bytes[offset+1] === 0x4B && 
          bytes[offset+2] === 0x03 && bytes[offset+3] === 0x04) {
        
        const compression = bytes[offset+8] | (bytes[offset+9] << 8);
        const compSize = bytes[offset+18] | (bytes[offset+19] << 8) | (bytes[offset+20] << 16) | (bytes[offset+21] << 24);
        const uncompSize = bytes[offset+22] | (bytes[offset+23] << 8) | (bytes[offset+24] << 16) | (bytes[offset+25] << 24);
        const nameLen = bytes[offset+26] | (bytes[offset+27] << 8);
        const extraLen = bytes[offset+28] | (bytes[offset+29] << 8);
        const dataOffset = offset + 30 + nameLen + extraLen;
        
        const name = new TextDecoder().decode(bytes.slice(offset+30, offset+30+nameLen));
        
        if (name.endsWith('.txt') || name.endsWith('.csv')) {
          const compressedData = bytes.slice(dataOffset, dataOffset + compSize);
          
          if (compression === 8) {
            // DEFLATE compressed - use DecompressionStream
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            const reader = ds.readable.getReader();
            
            writer.write(compressedData);
            writer.close();
            
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            
            const totalLen = chunks.reduce((a, c) => a + c.length, 0);
            const result = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
            
            txtContent = new TextDecoder().decode(result);
          } else if (compression === 0) {
            txtContent = new TextDecoder().decode(compressedData);
          }
          break;
        }
        
        offset = dataOffset + compSize;
      } else {
        offset++;
      }
    }
    
    // Search for AAPL in the text
    const lines = txtContent ? txtContent.split('\n').filter(l => l.includes('AAPL')) : [];
    
    return new Response(JSON.stringify({
      zipSize: arrayBuffer.byteLength,
      txtFound: !!txtContent,
      txtLength: txtContent?.length,
      aaplLines: lines.slice(0, 5),
      firstLine: txtContent?.split('\n')[0], // header row
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { 
      headers: { ...cors, 'Content-Type': 'application/json' } 
    });
  }
}
