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

async function getCompanyDescription(ticker, companyName) {
  // Strategy 1: Wikipedia REST API using company name from Finnhub
  // Convert "Apple Inc" -> "Apple_Inc" for Wikipedia lookup
  async function tryWikipedia(searchTerm) {
    try {
      // Search Wikipedia for the company
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerm)}&format=json&srlimit=5&srprop=snippet`;
      const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' } });
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json();
      const hits = searchData?.query?.search || [];

      // Find best match - prefer exact company name match
      let bestTitle = null;
      for (const hit of hits) {
        const t = hit.title.toLowerCase();
        const name = searchTerm.toLowerCase().replace(/[,\.]/g,'').trim();
        if (t === name || t.startsWith(name.split(' ')[0])) {
          bestTitle = hit.title;
          break;
        }
      }
      if (!bestTitle && hits.length) bestTitle = hits[0].title;
      if (!bestTitle) return null;

      // Fetch the summary for that article
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;
      const summaryRes = await fetch(summaryUrl, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' } });
      if (!summaryRes.ok) return null;
      const summary = await summaryRes.json();
      if (summary.type === 'disambiguation' || !summary.extract) return null;

      return {
        description: summary.extract,
        wikiTitle: summary.title,
        wikiUrl: summary.content_urls?.desktop?.page || null,
      };
    } catch(e) { return null; }
  }

  // Try company name first, then ticker-based search
  const searches = [
    companyName,                                    // "Apple Inc"
    companyName?.replace(/\s+(Inc|Corp|Ltd|Co|LLC|Group|Holdings)\.?$/i, '').trim(), // "Apple"
    `${ticker} stock company`,                     // "AAPL stock company"
  ].filter(Boolean);

  for (const term of searches) {
    const result = await tryWikipedia(term);
    if (result?.description && result.description.length > 50) return result;
  }
  return null;
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
    const companyName = fh.name || ticker;
    // Fetch EDGAR facts and Wikipedia description in parallel
    const [edgarFacts, wikiProfile] = await Promise.all([
      cik ? getEdgarFacts(cik) : null,
      getCompanyDescription(ticker, companyName),
    ]);

    const m = fhMetrics || {};

    const edgarDesc = null; // using Wikipedia now

    // Extract financials from EDGAR XBRL
    const revenue = getLatestValue(edgarFacts, 'RevenueFromContractWithCustomerExcludingAssessedTax') || getLatestValue(edgarFacts, 'Revenues') || getLatestValue(edgarFacts, 'SalesRevenueNet');
    const costOfRevenue = getLatestValue(edgarFacts, 'CostOfGoodsSold') || getLatestValue(edgarFacts, 'CostOfRevenue') || getLatestValue(edgarFacts, 'CostOfGoodsAndServicesSold');
    const grossProfit = getLatestValue(edgarFacts, 'GrossProfit');
    const rndExpense = getLatestValue(edgarFacts, 'ResearchAndDevelopmentExpense');
    const sgaExpense = getLatestValue(edgarFacts, 'SellingGeneralAndAdministrativeExpense')
      || (() => {
        const sm = getLatestValue(edgarFacts, 'SellingAndMarketingExpense');
        const ga = getLatestValue(edgarFacts, 'GeneralAndAdministrativeExpense');
        return (sm != null && ga != null) ? sm + ga : (sm || ga || null);
      })();
    const operatingExpenses = getLatestValue(edgarFacts, 'OperatingExpenses');
    const operatingIncome = getLatestValue(edgarFacts, 'OperatingIncomeLoss');
    const pretaxIncome = getLatestValue(edgarFacts, 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest');
    const taxExpense = getLatestValue(edgarFacts, 'IncomeTaxExpenseBenefit');
    const netIncome = getLatestValue(edgarFacts, 'NetIncomeLoss');
    const epsBasic = getLatestValue(edgarFacts, 'EarningsPerShareBasic', 'USD/shares');
    const epsDiluted = getLatestValue(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const sharesBasic = getLatestValue(edgarFacts, 'WeightedAverageNumberOfSharesOutstandingBasic', 'shares');
    const sharesDiluted = getLatestValue(edgarFacts, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares');
    const totalAssets = getLatestValue(edgarFacts, 'Assets');
    const totalLiabilities = getLatestValue(edgarFacts, 'Liabilities');
    const totalEquity = getLatestValue(edgarFacts, 'StockholdersEquity') || getLatestValue(edgarFacts, 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest');
    const cash = getLatestValue(edgarFacts, 'CashAndCashEquivalentsAtCarryingValue') || getLatestValue(edgarFacts, 'Cash');
    const totalDebt = getLatestValue(edgarFacts, 'LongTermDebt') || getLatestValue(edgarFacts, 'DebtCurrent');
    const operatingCashflow = getLatestValue(edgarFacts, 'NetCashProvidedByUsedInOperatingActivities');
    const _capexConcepts = ['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForCapitalImprovements','PaymentsToAcquireProductiveAssets'];
    const capex = _capexConcepts.reduce((v, c) => v || getLatestValue(edgarFacts, c), null);
    const freeCashflow = (operatingCashflow && capex) ? operatingCashflow - capex : null;
    const eps = epsBasic || epsDiluted;
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
    // Pick revenue concept with most recent data
    const _revCheck = (c) => {
      const d = edgarFacts?.facts?.['us-gaap']?.[c]?.units?.USD || [];
      const latest = d.filter(e => e.form==='10-K' && e.val!=null && e.start).sort((a,b)=>b.end.localeCompare(a.end));
      return latest[0]?.end || '';
    };
    const revConcept = ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']
      .sort((a,b) => _revCheck(b).localeCompare(_revCheck(a)))[0];
    const _corConcepts = ['CostOfGoodsSold','CostOfRevenue','CostOfGoodsAndServicesSold'];
    const corConcept = _corConcepts.sort((a,b) => _revCheck(b).localeCompare(_revCheck(a)))[0];
    const revenueHistory     = getHistoricalValues(edgarFacts, revConcept);
    const revenueQtrs        = getQuarterlyValues(edgarFacts, revConcept);
    const costOfRevHistory   = getHistoricalValues(edgarFacts, corConcept);
    const costOfRevQtrs      = getQuarterlyValues(edgarFacts, corConcept);
    const grossProfitHistory = getHistoricalValues(edgarFacts, 'GrossProfit');
    const grossProfitQtrs    = getQuarterlyValues(edgarFacts, 'GrossProfit');
    const rndHistory         = getHistoricalValues(edgarFacts, 'ResearchAndDevelopmentExpense')
      .concat(getHistoricalValues(edgarFacts, 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'))
      .filter((v,i,a) => a.findIndex(x=>x.end===v.end)===i)
      .sort((a,b)=>b.end.localeCompare(a.end)).slice(0,4);
    const rndQtrs            = getQuarterlyValues(edgarFacts, 'ResearchAndDevelopmentExpense')
      .concat(getQuarterlyValues(edgarFacts, 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'))
      .filter((v,i,a) => a.findIndex(x=>x.end===v.end)===i)
      .sort((a,b)=>b.end.localeCompare(a.end)).slice(0,8);
    const _sgaCombined = (arr1, arr2) => {
      if (!arr1.length && !arr2.length) return [];
      const map = {};
      arr1.forEach(d => { map[d.end] = {...d}; });
      arr2.forEach(d => { if (map[d.end]) map[d.end].value += d.value; else map[d.end] = {...d}; });
      return Object.values(map).sort((a,b) => b.end.localeCompare(a.end));
    };
    const _sgaDirectHist = getHistoricalValues(edgarFacts, 'SellingGeneralAndAdministrativeExpense');
    const sgaHistory = _sgaDirectHist.length ? _sgaDirectHist
      : _sgaCombined(getHistoricalValues(edgarFacts,'SellingAndMarketingExpense'), getHistoricalValues(edgarFacts,'GeneralAndAdministrativeExpense'));
    const _sgaDirectQtrs = getQuarterlyValues(edgarFacts, 'SellingGeneralAndAdministrativeExpense');
    const sgaQtrs = _sgaDirectQtrs.length ? _sgaDirectQtrs
      : _sgaCombined(getQuarterlyValues(edgarFacts,'SellingAndMarketingExpense'), getQuarterlyValues(edgarFacts,'GeneralAndAdministrativeExpense'));
    const opIncomeHistory    = getHistoricalValues(edgarFacts, 'OperatingIncomeLoss');
    const opIncomeQtrs       = getQuarterlyValues(edgarFacts, 'OperatingIncomeLoss');
    const pretaxHistory      = getHistoricalValues(edgarFacts, 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest');
    const pretaxQtrs         = getQuarterlyValues(edgarFacts, 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest');
    const taxHistory         = getHistoricalValues(edgarFacts, 'IncomeTaxExpenseBenefit');
    const taxQtrs            = getQuarterlyValues(edgarFacts, 'IncomeTaxExpenseBenefit');
    const netIncomeHistory   = getHistoricalValues(edgarFacts, 'NetIncomeLoss');
    const netIncomeQtrs      = getQuarterlyValues(edgarFacts, 'NetIncomeLoss');
    const epsBasicHistory    = getHistoricalValues(edgarFacts, 'EarningsPerShareBasic', 'USD/shares');
    const epsBasicQtrs       = getQuarterlyValues(edgarFacts, 'EarningsPerShareBasic', 'USD/shares');
    const epsDilutedHistory  = getHistoricalValues(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const epsQtrs            = getQuarterlyValues(edgarFacts, 'EarningsPerShareDiluted', 'USD/shares');
    const sharesBasicHistory = getHistoricalValues(edgarFacts, 'WeightedAverageNumberOfSharesOutstandingBasic', 'shares');
    const sharesBasicQtrs    = getQuarterlyValues(edgarFacts, 'WeightedAverageNumberOfSharesOutstandingBasic', 'shares');
    const cashHistory        = getInstantValues(edgarFacts, 'CashAndCashEquivalentsAtCarryingValue');
    const cashQtrs           = getInstantQtrs(edgarFacts, 'CashAndCashEquivalentsAtCarryingValue');
    const totalAssetsHistory = getInstantValues(edgarFacts, 'Assets');
    const totalAssetsQtrs    = getInstantQtrs(edgarFacts, 'Assets');
    const totalLiabHistory   = getInstantValues(edgarFacts, 'Liabilities');
    const totalLiabQtrs      = getInstantQtrs(edgarFacts, 'Liabilities');
    const totalEquityHistory = getInstantValues(edgarFacts, 'StockholdersEquity');
    const totalEquityQtrs    = getInstantQtrs(edgarFacts, 'StockholdersEquity');
    const debtHistory        = getInstantValues(edgarFacts, 'LongTermDebt');
    const debtQtrs           = getInstantQtrs(edgarFacts, 'LongTermDebt');
    const currentAssetsHistory = getInstantValues(edgarFacts, 'AssetsCurrent');
    const currentAssetsQtrs    = getInstantQtrs(edgarFacts, 'AssetsCurrent');
    const currentLiabHistory   = getInstantValues(edgarFacts, 'LiabilitiesCurrent');
    const currentLiabQtrs      = getInstantQtrs(edgarFacts, 'LiabilitiesCurrent');
    const opCfHistory        = getHistoricalValues(edgarFacts, 'NetCashProvidedByUsedInOperatingActivities');
    const opCfQtrs           = getQuarterlyValues(edgarFacts, 'NetCashProvidedByUsedInOperatingActivities');
    const _getCapexHist = (fn) => {
      for (const c of ['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForCapitalImprovements','PaymentsToAcquireProductiveAssets']) {
        const r = fn(edgarFacts, c); if (r.length) return r;
      } return [];
    };
    const capexHistory       = _getCapexHist(getHistoricalValues);
    const capexQtrs          = _getCapexHist(getQuarterlyValues);

    return new Response(JSON.stringify({
      // Profile — Wikipedia description + Finnhub metadata
      name: companyName,
      description: wikiProfile?.description || null,
      wikiUrl: wikiProfile?.wikiUrl || null,
      sector: fh.finnhubIndustry || null,
      industry: fh.finnhubIndustry || null,
      website: fh.weburl || null,
      phone: fh.phone || null,
      employees: fh.employeeTotal || null,
      country: fh.country || null,
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
      dividendYield: m['dividendYieldIndicatedAnnual'] ? parseFloat(m['dividendYieldIndicatedAnnual']).toFixed(2)+'%' : null,
      week52High: m['52WeekHigh'] || null,
      week52Low: m['52WeekLow'] || null,
      fiftyDayAvg: m['50DayMovingAverage'] || null,
      twoHundredDayAvg: m['200DayMovingAverage'] || null,
      avgVolume: m['10DayAverageTradingVolume'] ? Math.round(m['10DayAverageTradingVolume']*1e6) : null,

      // Income Statement (from EDGAR)
      revenue: fmt(revenue),
      costOfRevenue: fmt(costOfRevenue),
      grossProfit: fmt(grossProfit),
      rndExpense: fmt(rndExpense),
      sgaExpense: fmt(sgaExpense),
      operatingExpenses: fmt(operatingExpenses),
      operatingIncome: fmt(operatingIncome),
      pretaxIncome: fmt(pretaxIncome),
      taxExpense: fmt(taxExpense),
      netIncome: fmt(netIncome),
      epsBasic: epsBasic ? parseFloat(epsBasic).toFixed(2) : null,
      epsDiluted: epsDiluted ? parseFloat(epsDiluted).toFixed(2) : null,
      sharesBasic: sharesBasic ? fmt(sharesBasic, 'shares') : null,
      sharesDiluted: sharesDiluted ? fmt(sharesDiluted, 'shares') : null,
      grossMargin: grossMargin ? (grossMargin*100).toFixed(1)+'%' : null,
      operatingMargin: operatingMargin ? (operatingMargin*100).toFixed(1)+'%' : null,
      profitMargin: netMargin ? (netMargin*100).toFixed(1)+'%' : null,
      revenueHistory, revenueQtrs,
      costOfRevHistory, costOfRevQtrs,
      grossProfitHistory, grossProfitQtrs,
      rndHistory, rndQtrs,
      sgaHistory, sgaQtrs,
      opIncomeHistory, opIncomeQtrs,
      pretaxHistory, pretaxQtrs,
      taxHistory, taxQtrs,
      netIncomeHistory, netIncomeQtrs,
      epsBasicHistory, epsBasicQtrs,
      epsDilutedHistory, epsQtrs,
      sharesBasicHistory, sharesBasicQtrs,
      cashHistory, cashQtrs,
      totalAssetsHistory, totalAssetsQtrs,
      totalLiabHistory, totalLiabQtrs,
      totalEquityHistory, totalEquityQtrs,
      debtHistory, debtQtrs,
      currentAssetsHistory, currentAssetsQtrs,
      currentLiabHistory, currentLiabQtrs,
      opCfHistory, opCfQtrs,
      capexHistory, capexQtrs,

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
      revenueHistory, revenueQtrs,
      costOfRevHistory, costOfRevQtrs,
      grossProfitHistory, grossProfitQtrs,
      rndHistory, rndQtrs,
      sgaHistory, sgaQtrs,
      opIncomeHistory, opIncomeQtrs,
      pretaxHistory, pretaxQtrs,
      taxHistory, taxQtrs,
      netIncomeHistory, netIncomeQtrs,
      epsBasicHistory, epsBasicQtrs,
      epsDilutedHistory, epsQtrs,
      sharesBasicHistory, sharesBasicQtrs,
      cashHistory, cashQtrs,
      totalAssetsHistory, totalAssetsQtrs,
      totalLiabHistory, totalLiabQtrs,
      totalEquityHistory, totalEquityQtrs,
      debtHistory, debtQtrs,
      currentAssetsHistory, currentAssetsQtrs,
      currentLiabHistory, currentLiabQtrs,
      opCfHistory, opCfQtrs,
      capexHistory, capexQtrs,

      _source: 'edgar+finnhub+wikipedia',
      _edgarAvailable: !!edgarFacts,
    }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
