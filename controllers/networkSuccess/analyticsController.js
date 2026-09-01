import Division from "../../models/Division.js";
import { canAccessDivision } from "../../middleware/access.js";
import { startOfWeek, addDays } from "../../utils/weeklyMetrics.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { routeDailyData, computeRankings } from "../../utils/kpi/rankings.js";
import { getEffectiveKpiSettings } from "../../utils/kpi/settings.js";
import { weeklySeries, monthlySeries, monthFloor } from "../../utils/kpi/series.js";
import { holtForecast, madScores, segmentRankings } from "../../utils/kpi/stats.js";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const safeMean = (values) => {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

// ---------------------------------------------------------------------------
// Weekly Analytics
// ---------------------------------------------------------------------------
export const getWeeklyAnalytics = async (req, res) => {
  const { division: divisionId, weekStart: weekStartParam } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });
  const kpiSettings = await getEffectiveKpiSettings(division);

  const weekStart = startOfWeek(weekStartParam);
  const weeks = await weeklySeries(division, kpiSettings, weekStart, 6);
  const current = weeks[weeks.length - 1];

  const otpSeries = weeks.map((w) => w.summary.avgOtp).filter((v) => v != null);
  const tripSeries = weeks.map((w) => w.summary.totalTrips);
  const otpForecast = holtForecast(otpSeries, 4);
  const tripForecast = holtForecast(tripSeries, 4);

  const segmented = segmentRankings(current.rankings, (r) => r.composite ?? 0);
  const outliers = madScores(current.rankings, (r) => r.composite ?? 0);

  const quadrant = current.rankings.map((r) => ({
    route: r.route,
    provider: r.provider,
    otp: r.avgOtp,
    shf: r.avgShf,
    trips: r.totalTrips,
    meetsOtp: r.meetsOtp,
    meetsShf: r.meetsShf,
  }));

  const targetsMetDistribution = [0, 1, 2, 3, 4, 5, 6].map((n) => ({
    targetsMet: n,
    count: current.rankings.filter((r) => 6 - r.failedKpis.length === n).length,
  }));

  res.json({
    weeks: weeks.map((w) => ({ weekStart: w.weekStart, summary: w.summary })),
    otpForecast,
    tripForecast,
    segments: segmented.map((r) => ({ route: r.route, provider: r.provider, composite: r.composite, segment: r.segment })),
    outliers: outliers.filter((r) => r.isOutlier).map((r) => ({ route: r.route, provider: r.provider, madScore: r.madScore })),
    quadrant,
    otpThresh: kpiSettings.otpThresh,
    shfThresh: kpiSettings.shfThresh,
    targetsMetDistribution,
  });
};

// ---------------------------------------------------------------------------
// Provider Diagnostics
// ---------------------------------------------------------------------------
const HIGHER_IS_BETTER = { avgOtp: true, avgShf: true, avgTpsh: true, avgRouteClosures: false, avgLateFirst: false, avgLateDeploy: false };
const TOLERANCE = { avgOtp: 0.01, avgShf: 0.01, avgTpsh: 0.02, avgRouteClosures: 0, avgLateFirst: 0, avgLateDeploy: 0 };
const MEETS_FLAG = { avgOtp: "meetsOtp", avgShf: "meetsShf", avgTpsh: "meetsTpsh", avgRouteClosures: "meetsRouteClosure", avgLateFirst: "meetsLateFirst", avgLateDeploy: "meetsLateDeploy" };

const percentileRank = (values, target, higherBetter) => {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  if (nums.length === 1) return 100;
  const better = nums.filter((v) => (higherBetter ? v < target : v > target)).length;
  return Math.round((better / nums.length) * 100);
};

export const getProviderDiagnostics = async (req, res) => {
  const { division: divisionId, provider, weekStart: weekStartParam } = req.query;
  if (!divisionId || !provider) return res.status(400).json({ message: "division and provider are required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });
  const kpiSettings = await getEffectiveKpiSettings(division);

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const rows = await buildTrackerRows(divisionId, weekStart, weekEnd);
  const daily = routeDailyData(rows);

  const providerLevel = computeRankings(daily, kpiSettings, ["provider"]);
  const target = providerLevel.find((p) => p.provider.toLowerCase() === provider.toLowerCase());
  if (!target) return res.status(404).json({ message: "No data for this provider this week." });
  const others = providerLevel.filter((p) => p.provider.toLowerCase() !== provider.toLowerCase());

  const comparison = Object.keys(HIGHER_IS_BETTER).map((key) => {
    const higherBetter = HIGHER_IS_BETTER[key];
    const targetVal = target[key];
    const restVal = safeMean(others.map((o) => o[key]));
    const gap = targetVal != null && restVal != null ? targetVal - restVal : null;
    let position = "Aligned";
    if (gap != null) {
      const tol = TOLERANCE[key];
      const ahead = higherBetter ? gap > tol : gap < -tol;
      const behind = higherBetter ? gap < -tol : gap > tol;
      position = ahead ? "Ahead" : behind ? "Behind" : "Aligned";
    }
    return {
      key,
      providerVal: round2(targetVal),
      networkVal: round2(restVal),
      gap: round2(gap),
      position,
      percentile: percentileRank(providerLevel.map((p) => p[key]), targetVal, higherBetter),
      meetsTarget: target[MEETS_FLAG[key]],
    };
  });

  const routeRows = computeRankings(
    daily.filter((r) => r.provider.toLowerCase() === provider.toLowerCase()),
    kpiSettings,
    ["provider", "route"]
  ).sort((a, b) => b.failedKpis.length - a.failedKpis.length);

  const operatorRows = computeRankings(
    daily.filter((r) => r.provider.toLowerCase() === provider.toLowerCase()),
    kpiSettings,
    ["provider", "route", "operator"]
  ).sort((a, b) => b.failedKpis.length - a.failedKpis.length);

  const weeks = await weeklySeries(division, kpiSettings, weekStart, 6);
  // weeklySeries only stores route-level rankings, so recompute provider-level
  // rankings per week here for the trend chart.
  const weeklyProviderTrend = [];
  for (const w of weeks) {
    const weekRows = await buildTrackerRows(divisionId, w.from, w.to);
    const weekDaily = routeDailyData(weekRows);
    const weekProviderLevel = computeRankings(weekDaily, kpiSettings, ["provider"]);
    const weekTarget = weekProviderLevel.find((p) => p.provider.toLowerCase() === provider.toLowerCase());
    weeklyProviderTrend.push({
      weekStart: w.weekStart,
      avgOtp: weekTarget?.avgOtp ?? null,
      avgShf: weekTarget?.avgShf ?? null,
      avgTpsh: weekTarget?.avgTpsh ?? null,
      composite: weekTarget?.composite ?? null,
    });
  }

  const missedTargets = comparison.filter((c) => c.meetsTarget === false);
  const findings = {
    overall:
      missedTargets.length === 0
        ? `${provider} is meeting all configured targets this week.`
        : `${provider} is missing ${missedTargets.length} of 6 targets this week.`,
    priorityGaps: missedTargets
      .sort((a, b) => (a.percentile ?? 100) - (b.percentile ?? 100))
      .slice(0, 3)
      .map((c) => c.key),
    strengths: comparison
      .filter((c) => c.meetsTarget && c.position === "Ahead")
      .slice(0, 3)
      .map((c) => c.key),
  };

  res.json({
    division: { id: division._id, code: division.code, name: division.name },
    provider,
    weekStart: iso(weekStart),
    weekEnd: iso(weekEnd),
    comparison,
    routeRows,
    operatorRows,
    weeklyTrend: weeklyProviderTrend,
    findings,
  });
};

// ---------------------------------------------------------------------------
// Monthly Analytics
// ---------------------------------------------------------------------------
export const getMonthlyAnalytics = async (req, res) => {
  const { division: divisionId, month } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });
  const kpiSettings = await getEffectiveKpiSettings(division);

  const monthStart = monthFloor(month ? new Date(month) : new Date());
  const months = await monthlySeries(division, kpiSettings, monthStart, 6);
  const current = months[months.length - 1];

  const dailySeries = [];
  const rows = await buildTrackerRows(divisionId, current.from, current.to);
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, { date: row.date, trips: 0, otpSum: 0, otpCount: 0 });
    const bucket = byDate.get(row.date);
    bucket.trips += row.totalTrips;
    bucket.otpSum += row.otpPct;
    bucket.otpCount += 1;
  }
  Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((b) => dailySeries.push({ date: b.date, trips: b.trips, avgOtp: round2(b.otpSum / b.otpCount) }));

  res.json({
    monthStart: current.monthStart,
    months: months.map((m) => ({ monthStart: m.monthStart, summary: m.summary })),
    dailySeries,
    rankings: current.rankings,
    summary: current.summary,
    kpiSettings,
  });
};
