export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com',
    };

    const modules = 'assetProfile,summaryDetail,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,earningsHistory,recommendationTrend,upgradeDowngradeHistory';
    const yahooUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;

    const res = await fetch(yahooUrl, { headers });
    if (!res.ok) throw new Error('Yahoo returned ' + res.status);

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) throw new Error('No data');

    const profile = result.assetProfile || {};
    const summary = result.summaryDetail || {};
    const fin = result.financialData || {};
    const stats = result.defaultKeyStatistics || {};
    const income = result.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
    const balance = result.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
    const cashflow = result.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
    const recTrend = result.recommendationTrend?.trend?.[0] || {};
    const upgrades = result.upgradeDowngradeHistory?.history?.slice(0, 10) || [];

    const fmt = (v) => {
      if (!v?.raw && v?.raw !== 0) return null;
      return v.fmt || v.raw;
    };

    const out = {
      // Company Profile
      name: profile.longName || ticker,
      description: profile.longBusinessSummary || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      website: profile.website || null,
      phone: profile.phone || null,
      address: [profile.address1, profile.city, profile.state, profile.zip, profile.country].filter(Boolean).join(', '),
      employees: profile.fullTimeEmployees || null,
      founded: null,
      exchange: summary.exchange || null,
      currency: summary.currency || 'USD',

      // Key Stats
      marketCap: fmt(summary.marketCap),
      enterpriseValue: fmt(stats.enterpriseValue),
      beta: fmt(summary.beta),
      pe: fmt(summary.trailingPE),
      forwardPE: fmt(summary.forwardPE),
      eps: fmt(stats.trailingEps),
      forwardEps: fmt(stats.forwardEps),
      peg: fmt(stats.pegRatio),
      ps: fmt(stats.priceToSalesTrailing12Months),
      pb: fmt(stats.priceToBook),
      evEbitda: fmt(stats.enterpriseToEbitda),
      evRevenue: fmt(stats.enterpriseToRevenue),

      // Dividends
      dividendYield: fmt(summary.dividendYield),
      dividendRate: fmt(summary.dividendRate),
      exDivDate: summary.exDividendDate?.fmt || null,
      payoutRatio: fmt(summary.payoutRatio),

      // 52 Week
      week52High: fmt(summary.fiftyTwoWeekHigh),
      week52Low: fmt(summary.fiftyTwoWeekLow),
      fiftyDayAvg: fmt(summary.fiftyDayAverage),
      twoHundredDayAvg: fmt(summary.twoHundredDayAverage),
      avgVolume: fmt(summary.averageVolume),
      avgVolume10Day: fmt(summary.averageVolume10days),
      sharesOutstanding: fmt(stats.sharesOutstanding),
      float: fmt(stats.floatShares),
      shortRatio: fmt(stats.shortRatio),
      shortPercent: fmt(stats.shortPercentOfFloat),

      // Financials - Income Statement
      revenue: fmt(income.totalRevenue),
      grossProfit: fmt(income.grossProfit),
      operatingIncome: fmt(income.operatingIncome),
      netIncome: fmt(income.netIncome),
      ebitda: fmt(income.ebitda),
      grossMargin: fmt(fin.grossMargins),
      operatingMargin: fmt(fin.operatingMargins),
      profitMargin: fmt(fin.profitMargins),
      revenueGrowth: fmt(fin.revenueGrowth),
      earningsGrowth: fmt(fin.earningsGrowth),

      // Balance Sheet
      totalAssets: fmt(balance.totalAssets),
      totalDebt: fmt(balance.totalDebt || balance.longTermDebt),
      cash: fmt(balance.cash),
      totalEquity: fmt(balance.totalStockholderEquity),
      bookValue: fmt(stats.bookValue),
      debtToEquity: fmt(fin.debtToEquity),
      currentRatio: fmt(fin.currentRatio),
      quickRatio: fmt(fin.quickRatio),

      // Cash Flow
      operatingCashflow: fmt(cashflow.totalCashFromOperatingActivities),
      capex: fmt(cashflow.capitalExpenditures),
      freeCashflow: fmt(fin.freeCashflow),
      roe: fmt(fin.returnOnEquity),
      roa: fmt(fin.returnOnAssets),

      // Analyst
      targetHigh: fmt(fin.targetHighPrice),
      targetLow: fmt(fin.targetLowPrice),
      targetMean: fmt(fin.targetMeanPrice),
      recommendation: fin.recommendationKey || null,
      analystCount: fin.numberOfAnalystOpinions?.raw || null,
      strongBuy: recTrend.strongBuy || 0,
      buy: recTrend.buy || 0,
      hold: recTrend.hold || 0,
      sell: recTrend.sell || 0,
      strongSell: recTrend.strongSell || 0,

      // Recent upgrades/downgrades
      upgrades: upgrades.map(u => ({
        firm: u.firm,
        action: u.action,
        fromGrade: u.fromGrade,
        toGrade: u.toGrade,
        date: u.epochGradeDate ? new Date(u.epochGradeDate * 1000).toLocaleDateString() : null,
      })),
    };

    return new Response(JSON.stringify(out), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
