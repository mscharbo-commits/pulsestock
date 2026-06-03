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

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com/quote/' + ticker,
    'Cache-Control': 'no-cache',
  };

  try {
    // Try v10 first, then v11 as fallback
    const modules = 'assetProfile,summaryDetail,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,recommendationTrend,upgradeDowngradeHistory';
    
    let result = null;

    // Try query1 first
    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`,
      `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`,
    ];

    for (const u of urls) {
      try {
        const r = await fetch(u, { headers });
        if (r.ok) {
          const data = await r.json();
          result = data?.quoteSummary?.result?.[0];
          if (result) break;
        }
      } catch(e) { continue; }
    }

    if (!result) {
      // Fallback: try Finnhub for basic profile
      const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';
      const fhRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`);
      if (fhRes.ok) {
        const fh = await fhRes.json();
        if (fh.name) {
          return new Response(JSON.stringify({
            name: fh.name,
            description: null,
            sector: fh.finnhubIndustry,
            industry: fh.finnhubIndustry,
            website: fh.weburl,
            phone: fh.phone,
            employees: fh.employeeTotal,
            address: fh.address || null,
            exchange: fh.exchange,
            marketCap: fh.marketCapitalization ? '$' + (fh.marketCapitalization/1000).toFixed(2) + 'T' : null,
            currency: fh.currency,
            logo: fh.logo,
            ipo: fh.ipo,
            _source: 'finnhub',
          }), {
            headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
          });
        }
      }
      throw new Error('No data available from any source');
    }

    const profile = result.assetProfile || {};
    const summary = result.summaryDetail || {};
    const fin = result.financialData || {};
    const stats = result.defaultKeyStatistics || {};
    const income = result.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
    const balance = result.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
    const cashflow = result.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
    const recTrend = result.recommendationTrend?.trend?.[0] || {};
    const upgrades = result.upgradeDowngradeHistory?.history?.slice(0, 10) || [];

    const fmt = (v) => (!v?.raw && v?.raw !== 0) ? null : (v.fmt || v.raw);

    return new Response(JSON.stringify({
      name: profile.longName || ticker,
      description: profile.longBusinessSummary || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      website: profile.website || null,
      phone: profile.phone || null,
      address: [profile.address1, profile.city, profile.state, profile.zip, profile.country].filter(Boolean).join(', '),
      employees: profile.fullTimeEmployees || null,
      exchange: summary.exchange || null,
      currency: summary.currency || 'USD',
      marketCap: fmt(summary.marketCap),
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
      dividendYield: fmt(summary.dividendYield),
      dividendRate: fmt(summary.dividendRate),
      exDivDate: summary.exDividendDate?.fmt || null,
      payoutRatio: fmt(summary.payoutRatio),
      week52High: fmt(summary.fiftyTwoWeekHigh),
      week52Low: fmt(summary.fiftyTwoWeekLow),
      fiftyDayAvg: fmt(summary.fiftyDayAverage),
      twoHundredDayAvg: fmt(summary.twoHundredDayAverage),
      avgVolume: fmt(summary.averageVolume),
      sharesOutstanding: fmt(stats.sharesOutstanding),
      float: fmt(stats.floatShares),
      shortRatio: fmt(stats.shortRatio),
      shortPercent: fmt(stats.shortPercentOfFloat),
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
      totalAssets: fmt(balance.totalAssets),
      totalDebt: fmt(balance.totalDebt || balance.longTermDebt),
      cash: fmt(balance.cash),
      totalEquity: fmt(balance.totalStockholderEquity),
      bookValue: fmt(stats.bookValue),
      debtToEquity: fmt(fin.debtToEquity),
      currentRatio: fmt(fin.currentRatio),
      quickRatio: fmt(fin.quickRatio),
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
      upgrades: upgrades.map(u => ({
        firm: u.firm,
        action: u.action,
        fromGrade: u.fromGrade,
        toGrade: u.toGrade,
        date: u.epochGradeDate ? new Date(u.epochGradeDate * 1000).toLocaleDateString() : null,
      })),
      _source: 'yahoo',
    }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
