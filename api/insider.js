export const config = { maxDuration: 15 };

const TITLE_MAP = {
  'CEO':'CEO', 'CFO':'CFO', 'COO':'COO', 'CTO':'CTO', 'CMO':'CMO',
  'President':'President', 'Director':'Director', 'Chairman':'Chairman',
  'VP':'VP', 'SVP':'SVP', 'EVP':'EVP', 'General Counsel':'Gen. Counsel',
  'Chief Executive':'CEO', 'Chief Financial':'CFO', 'Chief Operating':'COO',
};

function cleanTitle(t) {
  if(!t) return '';
  for(var k in TITLE_MAP) { if(t.includes(k)) return TITLE_MAP[k]; }
  return t.split(' ').slice(0,3).join(' ');
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' };
  if(req.method==='OPTIONS') return new Response(null, {headers:cors});

  let ticker;
  try {
    const base = req.url.startsWith('http') ? '' : 'https://x.com';
    ticker = new URL(base + req.url).searchParams.get('ticker')?.toUpperCase();
  } catch {
    ticker = (req.url.split('?')[1]||'').split('&').map(p=>p.split('=')).find(p=>p[0]==='ticker')?.[1]?.toUpperCase();
  }
  if(!ticker) return new Response(JSON.stringify({error:'ticker required'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});

  const FINNHUB_KEY = process.env.FINNHUB_KEY;
  if(!FINNHUB_KEY) return new Response(JSON.stringify({error:'No API key'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});

  try {
    // Finnhub insider transactions endpoint
    const res = await fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`);
    if(!res.ok) throw new Error(`Finnhub ${res.status}`);
    const json = await res.json();

    const raw = (json.data || []).filter(function(t) {
      // Only P (purchase) and S (sale) — skip option exercises, awards, etc.
      return t.transactionCode === 'P' || t.transactionCode === 'S';
    });

    // Sort newest first
    raw.sort(function(a,b){ return new Date(b.transactionDate) - new Date(a.transactionDate); });

    // Filter to last 12 months
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear()-1);
    const recent = raw.filter(function(t){ return new Date(t.transactionDate) >= cutoff; });

    const transactions = recent.map(function(t) {
      var shares = Math.abs(t.share || 0);
      var price  = t.transactionPrice || 0;
      var value  = shares * price;
      return {
        name:   t.name || 'Unknown',
        title:  cleanTitle(t.officerTitle || ''),
        type:   t.transactionCode === 'P' ? 'buy' : 'sell',
        code:   t.transactionCode,
        shares: shares,
        price:  price || null,
        value:  value || null,
        date:   t.transactionDate,
        filingDate: t.filingDate,
      };
    });

    return new Response(JSON.stringify({
      ticker, transactions,
      source: 'SEC Form 4 / Finnhub',
      fetchedAt: new Date().toISOString(),
    }), { headers: {...cors,'Content-Type':'application/json','Cache-Control':'public,max-age=3600'} });

  } catch(err) {
    return new Response(JSON.stringify({error: err.message}), {status:500, headers:{...cors,'Content-Type':'application/json'}});
  }
}
