export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*'};
  try {
    const r = await fetch('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    const data = await r.json();
    const gaap = data.facts?.['us-gaap'] || {};
    
    // Find revenue-related concepts and their latest entries
    const revConcepts = Object.keys(gaap).filter(k => 
      k.toLowerCase().includes('revenue') || k.toLowerCase().includes('sales')
    );
    
    const summary = {};
    revConcepts.forEach(concept => {
      const entries = gaap[concept]?.units?.USD || [];
      const annual = entries.filter(e => e.form === '10-K' && e.val != null && e.start);
      const latest = annual.sort((a,b) => b.end.localeCompare(a.end)).slice(0,3);
      if (latest.length) {
        summary[concept] = latest.map(e => ({
          end: e.end, start: e.start, 
          days: Math.round((new Date(e.end) - new Date(e.start)) / 86400000),
          val: e.val, form: e.form
        }));
      }
    });
    
    return new Response(JSON.stringify({ revConcepts, summary }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
