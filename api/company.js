export const config = { runtime: 'edge' };

const FINNHUB_KEY = 'd8fhh6hr01qn443a0bngd8fhh6hr01qn443a0bo0';

async function getYahooData(ticker) {
  const modules = 'assetProfile,summaryDetail,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,recommendationTrend,upgradeDowngradeHistory';
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  ];
  const endpoints = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}`,
    `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${ticker}?modules=${modules}`,
  ];
  for (const agent of agents) {
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { headers: {
          'User-Agent': agent,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com/',
        }});
        if (!r.ok) continue;
        const data = await r.json();
        const result = data?.quoteSummary?.result?.[0];
        if (result) return result;
      } catch(e) { continue; }
    }
  }
  return null;
}

async function scrapeYahooProfile(ticker) {
  // Scrape description from Yahoo Finance profile page
  try {
    const r = await fetch(`https://finance.yahoo.com/quote/${ticker}/profile/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Description is in a <p> tag with class containing 'description' or after 'About' heading
    const descMatch = html.match(/"longBusinessSummary":"([^"]+)"/);
    const empMatch = html.match(/"fullTimeEmployees":(\d+)/);
    const sectorMatch = html.match(/"sector":"([^"]+)"/);
    const industryMatch = html.match(/"industry":"([^"]+)"/);
    const addressMatch = html.match(/"address1":"([^"]+)"/);
    const cityMatch = html.match(/"city":"([^"]+)"/);
    const stateMatch = html.match(/"state":"([^"]+)"/);
    const countryMatch = html.match(/"country":"([^"]+)"/);

    return {
      description: descMatch ? descMatch[1].replace(/\\n/g,' ').replace(/\\u\w{4}/g,'') : null,
      employees: empMatch ? parseInt(empMatch[1]) : null,
      sector: sectorMatch ? sectorMatch[1] : null,
      industry: industryMatch ? industryMatch[1] : null,
      address: [addressMatch?.[1], cityMatch?.[1], stateMatch?.[1], countryMatch?.[1]].filter(Boolean).join(', ') || null,
    };
  } catch(e) { return null; }
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

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({}), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const [yahooResult, yahooProfile, fhProfile, fhMetrics] = await Promise.all([
      getYahooData(ticker),
      scrapeYahooProfile(ticker),
      getFinnhubProfile(ticker),
      getFinnhubMetrics(ticker),
    ]);

    const fmt = (v) => (!v?.raw && v?.raw !== 0) ? null : (v.fmt || v.raw);

    if (yahooResult) {
      const profile = yahooResult.assetProfile || {};
      const summary = yahooResult.summaryDetail || {};
      const fin = yahooResult.financialData || {};
      const stats = yahooResult.defaultKeyStatistics || {};
      const income = yahooResult.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
      const balance = yahooResult.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
      const cashflow = yahooResult.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
      const recTrend = yahooResult.recommendationTrend?.trend?.[0] || {};
      const upgrades = yahooResult.upgradeDowngradeHistory?.history?.slice(0, 10) || [];
      const desc = profile.longBusinessSummary || yahooProfile?.description || null;

      return new Response(JSON.stringify({
        name: profile.longName || fhProfile?.name || ticker,
        description: desc,
        sector: profile.sector || yahooProfile?.sector || fhProfile?.finnhubIndustry || null,
        industry: profile.industry || yahooProfile?.industry || null,
        website: profile.website || fhProfile?.weburl || null,
        phone: profile.phone || fhProfile?.phone || null,
        employees: profile.fullTimeEmployees || yahooProfile?.employees || fhProfile?.employeeTotal || null,
        address: [profile.address1, profile.city, profile.state, profile.zip, profile.country].filter(Boolean).join(', ') || yahooProfile?.address || null,
        exchange: fhProfile?.exchange || null,
        marketCap: fmt(summary.marketCap),
        logo: fhProfile?.logo || null,
        ipo: fhProfile?.ipo || null,
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
        _source: 'yahoo',
      }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
    }

    // Yahoo blocked — use Finnhub + scraped profile
    const fh = fhProfile || {};
    const m = fhMetrics || {};
    return new Response(JSON.stringify({
      name: fh.name || ticker,
      description: yahooProfile?.description || null,
      sector: yahooProfile?.sector || fh.finnhubIndustry || null,
      industry: yahooProfile?.industry || fh.finnhubIndustry || null,
      website: fh.weburl || null,
      phone: fh.phone || null,
      employees: yahooProfile?.employees || fh.employeeTotal || null,
      address: yahooProfile?.address || null,
      exchange: fh.exchange || null,
      marketCap: fh.marketCapitalization ? '$' + (fh.marketCapitalization >= 1000 ? (fh.marketCapitalization/1000).toFixed(2)+'T' : fh.marketCapitalization.toFixed(2)+'B') : null,
      logo: fh.logo || null,
      ipo: fh.ipo || null,
      pe: m['peTTM'] || null,
      eps: m['epsTTM'] || null,
      week52High: m['52WeekHigh'] || null,
      week52Low: m['52WeekLow'] || null,
      beta: m['beta'] || null,
      _source: 'finnhub+scrape',
    }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
