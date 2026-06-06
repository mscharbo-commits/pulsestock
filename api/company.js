export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getWikipediaDescription(companyName, ticker) {
  // Try Wikipedia REST API - free, no key needed
  const searches = [
    companyName?.replace(/\s+(Inc\.?|Corp\.?|Ltd\.?|LLC|Co\.?|Company|Group|Holdings?|plc)$/i,'').trim(),
    companyName,
    ticker,
  ].filter(Boolean);

  for (const term of searches) {
    try {
      // Search Wikipedia
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=1&format=json&origin=*`;
      const sr = await fetch(searchUrl, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' } });
      if (!sr.ok) continue;
      const sd = await sr.json();
      const title = sd?.[1]?.[0];
      if (!title) continue;

      // Get summary
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const pr = await fetch(summaryUrl, { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' } });
      if (!pr.ok) continue;
      const pd = await pr.json();
      if (pd.extract && pd.extract.length > 50) {
        return pd.extract;
      }
    } catch(e) { continue; }
  }
  return null;
}

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

async function getEdgarFinancials(ticker) {
  try {
    // We already have a working edgar endpoint
    const r = await fetch(`https://pulsestock-nu.vercel.app/api/edgar?ticker=${ticker}`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function tryYahoo(ticker) {
  const modules = 'assetProfile,summaryDetail,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,recommendationTrend,upgradeDowngradeHistory';
  const attempts = [
    { url: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`, agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' },
    { url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`, agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
    { url: `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=${modules}`, agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15' },
  ];
  for (const { url, agent } of attempts) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': agent, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' } });
      if (!r.ok) continue;
      const data = await r.json();
      const result = data?.quoteSummary?.result?.[0];
      if (result) return result;
    } catch(e) { continue; }
  }
  return null;
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    // Run all sources in parallel
    const [yahooResult, fhProfile, fhMetrics] = await Promise.all([
      tryYahoo(ticker),
      getFinnhubProfile(ticker),
      getFinnhubMetrics(ticker),
    ]);

    const fh = fhProfile || {};
    const m = fhMetrics || {};
    const fmt = (v) => (!v?.raw && v?.raw !== 0) ? null : (v.fmt || v.raw);

    // Get Wikipedia description using company name
    const companyName = yahooResult?.assetProfile?.longName || fh.name || ticker;
    const wikiDesc = await getWikipediaDescription(companyName, ticker);

    if (yahooResult) {
      const profile = yahooResult.assetProfile || {};
      const summary = yahooResult.summaryDetail || {};
      const fin = yahooResult.financialData || {};
      const stats = yahooResult.defaultKeyStatistics || {};
      const income = yahooResult.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
      const balance = yahooResult.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
      const cashflow = yahooResult.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
      const recTrend = yahooResult.recommendationTrend?.trend?.[0] || {};
      const upgrades = yahooResult.upgradeDowngradeHistory?.history?.slice(0,10) || [];

      return new Response(JSON.stringify({
        name: profile.longName || fh.name || ticker,
        description: profile.longBusinessSummary || wikiDesc,
        sector: profile.sector || fh.finnhubIndustry || null,
        industry: profile.industry || null,
        website: profile.website || fh.weburl || null,
        phone: profile.phone || fh.phone || null,
        employees: profile.fullTimeEmployees || fh.employeeTotal || null,
        address: [profile.address1, profile.city, profile.state, profile.zip, profile.country].filter(Boolean).join(', ') || null,
        exchange: fh.exchange || null,
        marketCap: fmt(summary.marketCap),
        logo: fh.logo || null,
        ipo: fh.ipo || null,
        beta: fmt(summary.beta),
        pe: fmt(summary.trailingPE),
        forwardPE: fmt(summary.forwardPE),
        eps: fmt(stats.trailingEps),
        forwardEps: fmt(stats.forwardEps),
        peg: fmt(stats.pegRatio),
        pb: fmt(stats.priceToBook),
        evEbitda: fmt(stats.enterpriseToEbitda),
        dividendYield: fmt(summary.dividendYield),
        dividendRate: fmt(summary.dividendRate),
        exDivDate: summary.exDividendDate?.fmt || null,
        week52High: fmt(summary.fiftyTwoWeekHigh),
        week52Low: fmt(summary.fiftyTwoWeekLow),
        fiftyDayAvg: fmt(summary.fiftyDayAverage),
        twoHundredDayAvg: fmt(summary.twoHundredDayAverage),
        avgVolume: fmt(summary.averageVolume),
        sharesOutstanding: fmt(stats.sharesOutstanding),
        float: fmt(stats.floatShares),
        revenue: fmt(income.totalRevenue),
        grossProfit: fmt(income.grossProfit),
        operatingIncome: fmt(income.operatingIncome),
        netIncome: fmt(income.netIncome),
        grossMargin: fmt(fin.grossMargins),
        operatingMargin: fmt(fin.operatingMargins),
        profitMargin: fmt(fin.profitMargins),
        revenueGrowth: fmt(fin.revenueGrowth),
        earningsGrowth: fmt(fin.earningsGrowth),
        totalAssets: fmt(balance.totalAssets),
        totalDebt: fmt(balance.totalDebt || balance.longTermDebt),
        cash: fmt(balance.cash),
        totalEquity: fmt(balance.totalStockholderEquity),
        debtToEquity: fmt(fin.debtToEquity),
        currentRatio: fmt(fin.currentRatio),
        operatingCashflow: fmt(cashflow.totalCashFromOperatingActivities),
        freeCashflow: fmt(fin.freeCashflow),
        roe: fmt(fin.returnOnEquity),
        roa: fmt(fin.returnOnAssets),
        targetHigh: fmt(fin.targetHighPrice),
        targetLow: fmt(fin.targetLowPrice),
        targetMean: fmt(fin.targetMeanPrice),
        recommendation: fin.recommendationKey || null,
        strongBuy: recTrend.strongBuy || 0,
        buy: recTrend.buy || 0,
        hold: recTrend.hold || 0,
        sell: recTrend.sell || 0,
        strongSell: recTrend.strongSell || 0,
        upgrades: upgrades.map(u => ({ firm: u.firm, action: u.action, fromGrade: u.fromGrade, toGrade: u.toGrade, date: u.epochGradeDate ? new Date(u.epochGradeDate*1000).toLocaleDateString() : null })),
        _source: 'yahoo+wiki',
      }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
    }

    // Yahoo failed — use Finnhub + Wikipedia + Finnhub metrics
    return new Response(JSON.stringify({
      name: fh.name || ticker,
      description: wikiDesc,
      sector: fh.finnhubIndustry || null,
      industry: fh.finnhubIndustry || null,
      website: fh.weburl || null,
      phone: fh.phone || null,
      employees: fh.employeeTotal || null,
      address: null,
      exchange: fh.exchange || null,
      marketCap: fh.marketCapitalization ? '$' + (fh.marketCapitalization >= 1000 ? (fh.marketCapitalization/1000).toFixed(2)+'T' : fh.marketCapitalization.toFixed(2)+'B') : null,
      logo: fh.logo || null,
      ipo: fh.ipo || null,
      pe: m['peTTM'] || null,
      forwardPE: m['forwardPE'] || null,
      eps: m['epsTTM'] || null,
      pb: m['pbAnnual'] || null,
      week52High: m['52WeekHigh'] || null,
      week52Low: m['52WeekLow'] || null,
      beta: m['beta'] || null,
      dividendYield: m['dividendYieldIndicatedAnnual'] || null,
      roe: m['roeRfy'] || null,
      roa: m['roaRfy'] || null,
      revenueGrowth: m['revenueGrowthTTMYoy'] || null,
      grossMargin: m['grossMarginTTM'] || null,
      operatingMargin: m['operatingMarginTTM'] || null,
      netMargin: m['netProfitMarginTTM'] || null,
      _source: 'finnhub+wiki',
    }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
