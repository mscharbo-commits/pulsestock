export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
  if (req.method !== 'POST') return new Response('Method not allowed', {status:405});
  
  try {
    const {ticker, question} = await req.json();
    if (!ticker || !question) return new Response(JSON.stringify({error:'Missing ticker or question'}), {status:400, headers:cors});
    
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: 'You are a financial analyst. Answer this question about ' + ticker + ' in 2-3 concise paragraphs. Not financial advice.\n\nQuestion: ' + question
        }]
      })
    });
    
    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({error: 'Claude error: ' + resp.status}), {status:500, headers:cors});
    }
    
    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';
    return new Response(JSON.stringify({text}), {headers:cors});
    
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {status:500, headers:cors});
  }
}
