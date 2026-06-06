export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getFinnhubProfile(ticker) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function getFinnhubMetrics(ticker) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.metric || null;
  } catch(e) { return null; }
}

async function getEdgarFacts(cik) {
  try {
    const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com', 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function getEdgarCik(ticker) {
  try {
    const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=2020-01-01&forms=10-K,10-Q`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    // Try tickers.json first - SEC provides a full mapping
    const r2 = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    if (!r2.ok) return null;
    const data = await r2.json();
    const entry = Object.values(data).find(e => e.ticker?.toUpperCase() === ticker.toUpperCase());
    return entry ? String(entry.cik_str).padStart(10,'0') : null;
  } catch(e) { return null; }
}

function getLatestValue(facts, concept, unit = 'USD') {
  try {
    const data = facts?.facts?.['us-gaap']?.[concept]?.units?.[unit];
    if (!data || !data.length) return null;
    // Get most recent annual (10-K) value, then quarterly
    const annuals = data.filter(d => d.form === '10-K' && d.val != null).sort((a,b) => b.end?.localeCompare(a.end));
    if (annuals.length) return annuals[0].val;
    const qtrs = data.filter(d => (d.form === '10-Q' || d.form === '10-K') && d.val != null).sort((a,b) => b.end?.localeCompare(a.end));
    return qtrs.length ? qtrs[0].val : null;
  } catch(e) { return null; }
}

function getHistoricalValues(facts, concept, unit = 'USD', limit = 4) {
  try {
    const data = facts?.facts?.['us-gaap']?.[concept]?.units?.[unit];
    if (!data) return [];
    const annuals = data
      .filter(d => d.form === '10-K' && d.val != null && d.end)
      .sort((a,b) => b.end.localeCompare(a.end))
      .slice(0, limit);
    return annuals.map(d => ({ period: d.end?.substring(0,4), label: 'FY ' + d.end?.substring(0,4), value: d.val, type: 'annual' }));
  } catch(e) { return []; }
}

function getQuarterlyValues(facts, concept, unit = 'USD', limit = 4) {
  try {
    const data = facts?.facts?.['us-gaap']?.[concept]?.units?.[unit];
    if (!data) return [];
    // Quarterly values: form 10-Q, duration ~90 days
    const qtrs = data
      .filter(d => d.form === '10-Q' && d.val != null && d.end && d.start)
      .map(d => {
        const days = (new Date(d.end) - new Date(d.start)) / 86400000;
        return { ...d, days };
      })
      .filter(d => d.days >= 75 && d.days <= 105) // ~1 quarter duration
      .sort((a,b) => b.end.localeCompare(a.end))
      .slice(0, limit);
    return qtrs.map(d => {
      const endDate = new Date(d.end);
      const qtr = 'Q' + Math.ceil((endDate.getMonth()+1)/3);
      const yr = endDate.getFullYear();
      return { period: d.end?.substring(0,7), label: qtr + ' ' + yr, value: d.val, type: 'quarter' };
    });
  } catch(e) { return []; }
}

function fmt(val, type = 'currency') {
  if (val === null || val === undefined) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  if (type === 'currency') {
    if (Math.abs(n) >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    return '$' + n.toFixed(0);
  }
  if (type === 'pct') return (n * 100).toFixed(1) + '%';
  if (type === 'ratio') return n.toFixed(2) + 'x';
  return n.toFixed(2);
}

async function getEdgarDescription(cik) {
  try {
    if (!cik) return null;
    const cleanCik = cik.replace(/^0+/, '');

    // Get most recent 10-K filing
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'PulseStock research@pulsestock.com' }
    });
    if (!subRes.ok) return null;
    const sub = await subRes.json();
    const recent = sub.filings?.recent;
    const idx10k = recent?.form?.findIndex(f => f === '10-K');
    if (idx10k < 0) return null;

    const accession = recent.accessionNumber[idx10k].replace(/-/g,'');
    const primaryDoc = recent.primaryDocument[idx10k];
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${accession}/${primaryDoc}`;

    const docRes = await fetch(docUrl, { headers: { 'User-Agent': 'PulseStock research@pulsestock.com' } });
    if (!docRes.ok) return null;
    const html = await docRes.text();

    // Strip tags to plain text
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Find all "Item 1. Business" occurrences - last one is real content, first is TOC
    const matches = [];
    const pattern = /Item\s+1[\.\s]+Business/gi;
    let m;
    while ((m = pattern.exec(text)) !== null) matches.push(m.index);
    if (!matches.length) return null;

    const realIdx = matches[matches.length - 1];
    const endIdx = text.indexOf('Item 1A', realIdx + 30);
    const rawSection = text.substring(realIdx, endIdx > 0 ? endIdx : realIdx + 5000);

    const description = rawSection
      .replace(/^Item\s+1[\.\s]+Business\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1200);

    return description.length > 100 ? description : null;
  } catch(e) { return null; }
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const [fhProfile, fhMetrics, cik] = await Promise.all([
      getFinnhubProfile(ticker),
      getFinnhubMetrics(ticker),
      getEdgarCik(ticker),
    ]);

    const fh = fhProfile || {};
    const m = fhMetrics || {};
    const companyName = fh.name || ticker;

    // Fetch EDGAR facts and 10-K description in parallel
    const [edgarFacts, edgarDesc] = await Promise.all([
      cik ? getEdgarFacts(cik) : null,
      getEdgarDescription(cik),
    ]);

    // Extract financials from EDGAR XBRL
    const revenue = getLatestValue(edgarFacts, 'Revenues') || getLatestValue(edgarFacts, 'RevenueFromContractWithCustomerExcludingAssessedTax') || getLatestValue(edgarFacts, 'SalesRevenueNet');
    const netIncome = getLatestValue(edgarFacts, 'NetIncomeLoss');
    const grossProfit = getLatestValue(edgarFacts, 'GrossProfit');
    const operatingIncome = getLatestValue(edgarFacts, 'OperatingIncomeLoss');
    const totalAssets = getLatestValue(edgarFacts, 'Assets');
    const totalLiabilities = getLatestValue(edgarFacts, 'Liabilities');
    const totalEquity = getLatestValue(edgarFacts, 'StockholdersEquity') || getLatestValue(edgarFacts, 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest');
    const cash = getLatestValue(edgarFacts, 'CashAndCashEquivalentsAtCarryingValue') || getLatestValue(edgarFacts, 'Cash');
    const totalDebt = getLatestValue(edgarFacts, 'LongTermDebt') || getLatestValue(edgarFacts, 'DebtCurrent');
    const operatingCashflow = getLatestValue(edgarFacts, 'NetCashProvidedByUsedInOperatingActivities');
    const capex = getLatestValue(edgarFacts, 'PaymentsToAcquirePropertyPlantAndEquipment');
    const freeCashflow = (operatingCashflow && capex) ? operatingCashflow - capex : null;
    const eps = getLatestValue(edgarFacts, 'EarningsPerShareBasic', 'USD/shares') || getLatestValue(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const sharesOutstanding = getLatestValue(edgarFacts, 'CommonStockSharesOutstanding', 'shares');
    const currentAssets = getLatestValue(edgarFacts, 'AssetsCurrent');
    const currentLiabilities = getLatestValue(edgarFacts, 'LiabilitiesCurrent');

    // Calculate derived metrics
    const grossMargin = (grossProfit && revenue) ? grossProfit / revenue : null;
    const operatingMargin = (operatingIncome && revenue) ? operatingIncome / revenue : null;
    const netMargin = (netIncome && revenue) ? netIncome / revenue : null;
    const roe = (netIncome && totalEquity) ? netIncome / totalEquity : null;
    const roa = (netIncome && totalAssets) ? netIncome / totalAssets : null;
    const debtToEquity = (totalDebt && totalEquity) ? totalDebt / totalEquity : null;
    const currentRatio = (currentAssets && currentLiabilities) ? currentAssets / currentLiabilities : null;

    // Historical annual + quarterly data from EDGAR
    const revConcept = getLatestValue(edgarFacts, 'Revenues') ? 'Revenues' : 'RevenueFromContractWithCustomerExcludingAssessedTax';
    const revenueHistory   = getHistoricalValues(edgarFacts, revConcept);
    const revenueQtrs      = getQuarterlyValues(edgarFacts, revConcept);
    const netIncomeHistory = getHistoricalValues(edgarFacts, 'NetIncomeLoss');
    const netIncomeQtrs    = getQuarterlyValues(edgarFacts, 'NetIncomeLoss');
    const grossProfitHistory = getHistoricalValues(edgarFacts, 'GrossProfit');
    const epsHistory       = getHistoricalValues(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const epsQtrs          = getQuarterlyValues(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const cashHistory      = getHistoricalValues(edgarFacts, 'CashAndCashEquivalentsAtCarryingValue');
    const debtHistory      = getHistoricalValues(edgarFacts, 'LongTermDebt');

    return new Response(JSON.stringify({
      // Profile
      name: companyName,
      description: edgarDesc,
      sector: fh.finnhubIndustry || null,
      industry: fh.finnhubIndustry || null,
      website: fh.weburl || null,
      phone: fh.phone || null,
      employees: fh.employeeTotal || null,
      exchange: fh.exchange || null,
      marketCap: fh.marketCapitalization ? fmt(fh.marketCapitalization * 1e6) : null,
      logo: fh.logo || null,
      ipo: fh.ipo || null,
      cik,

      // Market metrics from Finnhub
      pe: m['peTTM'] ? parseFloat(m['peTTM']).toFixed(1) : null,
      forwardPE: m['forwardPE'] ? parseFloat(m['forwardPE']).toFixed(1) : null,
      eps: eps ? fmt(eps, 'ratio').replace('x','') : (m['epsTTM'] ? m['epsTTM'] : null),
      pb: m['pbAnnual'] ? parseFloat(m['pbAnnual']).toFixed(2) : null,
      beta: m['beta'] ? parseFloat(m['beta']).toFixed(2) : null,
      dividendYield: m['dividendYieldIndicatedAnnual'] ? (parseFloat(m['dividendYieldIndicatedAnnual'])*100).toFixed(2)+'%' : null,
      week52High: m['52WeekHigh'] || null,
      week52Low: m['52WeekLow'] || null,
      fiftyDayAvg: m['50DayMovingAverage'] || null,
      twoHundredDayAvg: m['200DayMovingAverage'] || null,
      avgVolume: m['10DayAverageTradingVolume'] ? Math.round(m['10DayAverageTradingVolume']*1e6) : null,

      // Income Statement (from EDGAR)
      revenue: fmt(revenue),
      grossProfit: fmt(grossProfit),
      operatingIncome: fmt(operatingIncome),
      netIncome: fmt(netIncome),
      grossMargin: grossMargin ? (grossMargin*100).toFixed(1)+'%' : null,
      operatingMargin: operatingMargin ? (operatingMargin*100).toFixed(1)+'%' : null,
      profitMargin: netMargin ? (netMargin*100).toFixed(1)+'%' : null,
      revenueHistory,
      revenueQtrs,
      netIncomeHistory,
      netIncomeQtrs,
      grossProfitHistory,
      epsHistory,
      epsQtrs,
      cashHistory,
      debtHistory,

      // Balance Sheet (from EDGAR)
      totalAssets: fmt(totalAssets),
      totalLiabilities: fmt(totalLiabilities),
      totalEquity: fmt(totalEquity),
      cash: fmt(cash),
      totalDebt: fmt(totalDebt),
      currentAssets: fmt(currentAssets),
      currentLiabilities: fmt(currentLiabilities),
      sharesOutstanding: sharesOutstanding ? fmt(sharesOutstanding, 'shares') : null,

      // Cash Flow (from EDGAR)
      operatingCashflow: fmt(operatingCashflow),
      capex: capex ? fmt(capex) : null,
      freeCashflow: fmt(freeCashflow),

      // Ratios
      roe: roe ? (roe*100).toFixed(1)+'%' : null,
      roa: roa ? (roa*100).toFixed(1)+'%' : null,
      debtToEquity: debtToEquity ? debtToEquity.toFixed(2) : null,
      currentRatio: currentRatio ? currentRatio.toFixed(2) : null,

      // Historical financials
      revenueHistory,
      revenueQtrs,
      netIncomeHistory,
      netIncomeQtrs,
      grossProfitHistory,
      epsHistory,
      epsQtrs,
      cashHistory,
      debtHistory,

      _source: 'edgar+finnhub+wiki',
      _edgarAvailable: !!edgarFacts,
    }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
