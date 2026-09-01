import Division from "../../models/Division.js";
import RunCut from "../../models/RunCut.js";
import { canAccessDivision } from "../../middleware/access.js";
import { startOfWeek, addDays } from "../../utils/weeklyMetrics.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { routeDailyData, computeRankings, networkSummary } from "../../utils/kpi/rankings.js";
import { getEffectiveKpiSettings } from "../../utils/kpi/settings.js";
import { normalizeRouteGroup } from "../../utils/kpi/routeFamily.js";
import { DAYS_OF_WEEK } from "../../utils/hours.js";
import { computeStreaks } from "../../utils/kpi/streaks.js";
import { weeklySeries } from "../../utils/kpi/series.js";
import { todayInTimezone } from "../../utils/timezone.js";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

const safeMean = (values) => {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

// ---------------------------------------------------------------------------
// End-of-Day Brief
// ---------------------------------------------------------------------------
export const getEodBrief = async (req, res) => {
  const { division: divisionId, reportDate, preparedBy } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });

  const cutoff = addDays(reportDate ? new Date(reportDate) : todayInTimezone(division.timezone), -1);
  const cutoffISO = iso(cutoff);
  const sameWeekdayLastWeek = iso(addDays(cutoff, -7));

  const dayRows = await buildTrackerRows(divisionId, cutoff, cutoff);
  const priorWeekRows = await buildTrackerRows(divisionId, addDays(cutoff, -7), addDays(cutoff, -7));

  const dayOfWeek = DAYS_OF_WEEK[cutoff.getUTCDay()];
  const templateRoutes = await RunCut.find({ division: divisionId, daysOfWeek: dayOfWeek }).populate("route", "code");
  const plannedFamilies = new Set(templateRoutes.map((rc) => normalizeRouteGroup(rc.route?.code)));

  const operatedFamilies = new Set(
    dayRows.filter((r) => r.actualHrs > 0 || r.totalTrips > 0).map((r) => r.route)
  );

  const totalActualHrs = dayRows.reduce((s, r) => s + r.actualHrs, 0);
  const totalSchedHrs = dayRows.reduce((s, r) => s + r.schedHrs, 0);
  const totalTrips = dayRows.reduce((s, r) => s + r.totalTrips, 0);

  const summary = {
    plannedRoutes: plannedFamilies.size,
    operatedRoutes: operatedFamilies.size,
    utilizationPct: plannedFamilies.size ? round2(operatedFamilies.size / plannedFamilies.size) : null,
    shfPct: totalSchedHrs ? round2(totalActualHrs / totalSchedHrs) : null,
    tpsh: totalActualHrs ? round2(totalTrips / totalActualHrs) : null,
    avgOtp: round2(safeMean(dayRows.map((r) => r.otpPct))),
    totalTrips,
    totalActualHrs: round2(totalActualHrs),
    routeClosures: dayRows.reduce((s, r) => s + r.routeClosures, 0),
    lateToFirst: dayRows.reduce((s, r) => s + r.lateToFirst, 0),
    lateDeploy: dayRows.reduce((s, r) => s + r.lateDeploy, 0),
  };

  const sameWeekday = {
    date: sameWeekdayLastWeek,
    avgOtp: round2(safeMean(priorWeekRows.map((r) => r.otpPct))),
    tpsh: (() => {
      const hrs = priorWeekRows.reduce((s, r) => s + r.actualHrs, 0);
      const trips = priorWeekRows.reduce((s, r) => s + r.totalTrips, 0);
      return hrs ? round2(trips / hrs) : null;
    })(),
  };

  const exceptionRoutes = dayRows
    .filter((r) => r.routeClosures > 0 || r.lateToFirst > 0 || r.lateDeploy > 0)
    .sort((a, b) => b.routeClosures - a.routeClosures || b.lateToFirst - a.lateToFirst || b.lateDeploy - a.lateDeploy)
    .map((r) => ({
      route: r.route,
      provider: r.provider,
      operator: r.operator,
      routeClosures: r.routeClosures,
      lateToFirst: r.lateToFirst,
      lateDeploy: r.lateDeploy,
      otpPct: round2(r.otpPct),
    }));

  res.json({
    division: { id: division._id, code: division.code, name: division.name },
    preparedBy: preparedBy || "",
    reportDate: reportDate ? iso(new Date(reportDate)) : iso(new Date()),
    cutoffDate: cutoffISO,
    dayOfWeek,
    summary,
    sameWeekday,
    exceptionRoutes,
  });
};

// ---------------------------------------------------------------------------
// Weekly Report
// ---------------------------------------------------------------------------
export const getWeeklyReport = async (req, res) => {
  const { division: divisionId, weekStart: weekStartParam } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const kpiSettings = await getEffectiveKpiSettings(division);

  const rows = await buildTrackerRows(divisionId, weekStart, weekEnd);
  const daily = routeDailyData(rows);
  const rankings = computeRankings(daily, kpiSettings);
  const summary = networkSummary(daily, rankings);

  res.json({
    division: { id: division._id, code: division.code, name: division.name },
    weekStart: iso(weekStart),
    weekEnd: iso(weekEnd),
    rankings,
    summary,
    kpiSettings,
    definitions: [
      ["OTP", "On-Time Performance — mean OTP% across reported days."],
      ["SHF", "Service Hour Fulfillment — actual hours ÷ scheduled hours."],
      ["TPSH", "Trips Per Service Hour — total trips ÷ actual hours."],
      ["Route Closures", "Average closures per day (lower is better)."],
      ["Late to First", "Average late-to-first-pickup events per day (lower is better)."],
      ["Late Deploy", "Average late-deploy events per day (lower is better)."],
    ],
  });
};

// ---------------------------------------------------------------------------
// Provider Check-In
// ---------------------------------------------------------------------------
export const getProviderCheckIn = async (req, res) => {
  const { division: divisionId, provider, weekStart: weekStartParam } = req.query;
  if (!divisionId || !provider) {
    return res.status(400).json({ message: "division and provider are required" });
  }
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const kpiSettings = await getEffectiveKpiSettings(division);

  const rows = (await buildTrackerRows(divisionId, weekStart, weekEnd)).filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  );
  const daily = routeDailyData(rows);
  const routeRows = computeRankings(daily, kpiSettings, ["provider", "route"]);
  const operatorRows = computeRankings(daily, kpiSettings, ["provider", "route", "operator"]);

  const weeks = await weeklySeries(division, kpiSettings, weekStart, 4);
  const streaks = computeStreaks(weeks);
  const repeatBottom5 = streaks.bottom.filter((r) => r.provider.toLowerCase() === provider.toLowerCase());

  const totalTrips = rows.reduce((s, r) => s + r.totalTrips, 0);
  const totalActualHrs = rows.reduce((s, r) => s + r.actualHrs, 0);
  const totalSchedHrs = rows.reduce((s, r) => s + r.schedHrs, 0);
  const daysTracked = new Set(rows.map((r) => r.date)).size;

  const weeklySummary = {
    totalTrips,
    totalActualHrs: round2(totalActualHrs),
    totalSchedHrs: round2(totalSchedHrs),
    utilizationPct: totalSchedHrs ? round2(totalActualHrs / totalSchedHrs) : null,
    avgTripsPerDay: daysTracked ? round2(totalTrips / daysTracked) : null,
    tpsh: totalActualHrs ? round2(totalTrips / totalActualHrs) : null,
    avgOtp: round2(safeMean(rows.map((r) => r.otpPct))),
    lateToFirst: rows.reduce((s, r) => s + r.lateToFirst, 0),
    lateDeploy: rows.reduce((s, r) => s + r.lateDeploy, 0),
    routesBelowOtp: routeRows.filter((r) => !r.meetsOtp).length,
    routesBelowUtilization: routeRows.filter((r) => !r.meetsShf).length,
  };

  const coachingPlan = [
    routeRows.some((r) => !r.meetsOtp)
      ? `Specific: ${routeRows.filter((r) => !r.meetsOtp).length} route(s) below the ${Math.round(
          kpiSettings.otpThresh * 100
        )}% OTP threshold.`
      : "Specific: all routes are meeting the OTP threshold this week.",
    `Measurable: OTP ≥ ${Math.round(kpiSettings.otpThresh * 100)}%, SHF ≥ ${Math.round(
      kpiSettings.shfThresh * 100
    )}%, TPSH ≥ ${kpiSettings.tpshBench}.`,
    "Achievable: focused coaching on the specific route(s) and days identified below.",
    "Relevant: directly tied to this week's contracted service standards.",
    `Timebound: follow-up due ${iso(addDays(weekEnd, 3))}.`,
  ];

  res.json({
    division: { id: division._id, code: division.code, name: division.name },
    provider,
    weekStart: iso(weekStart),
    weekEnd: iso(weekEnd),
    repeatBottom5,
    routeRows,
    operatorRows,
    weeklySummary,
    coachingPlan,
    kpiSettings,
  });
};

// ---------------------------------------------------------------------------
// Provider Performance Review
// ---------------------------------------------------------------------------
const periodMetrics = (rows, kpiSettings) => {
  const daily = routeDailyData(rows);
  const rankings = computeRankings(daily, kpiSettings, ["provider", "route"]);
  const summary = networkSummary(daily, rankings);
  return { rankings, summary };
};

export const getProviderPerformanceReview = async (req, res) => {
  const { division: divisionId, provider, weeks, from, to } = req.query;
  if (!divisionId || !provider) {
    return res.status(400).json({ message: "division and provider are required" });
  }
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });
  const kpiSettings = await getEffectiveKpiSettings(division);

  let recentFrom;
  let recentTo;
  let priorFrom;
  let priorTo;
  let note = "";

  if (from && to) {
    recentFrom = new Date(from);
    recentTo = new Date(to);
    const spanDays = Math.round((recentTo - recentFrom) / 86400000) + 1;
    priorTo = addDays(recentFrom, -1);
    priorFrom = addDays(priorTo, -(spanDays - 1));
    note = "Custom date range.";
  } else {
    const n = Number(weeks) || 4;
    const thisWeekStart = startOfWeek(new Date());
    recentTo = addDays(thisWeekStart, -1);
    recentFrom = addDays(thisWeekStart, -7 * n);
    priorTo = addDays(recentFrom, -1);
    priorFrom = addDays(priorTo, -7 * n + 1);
    note = `Last ${n} completed weeks vs. the preceding ${n} weeks.`;
  }

  const recentRows = (await buildTrackerRows(divisionId, recentFrom, recentTo)).filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  );
  const priorRows = (await buildTrackerRows(divisionId, priorFrom, priorTo)).filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  );

  if (!recentRows.length) {
    return res.status(404).json({ message: "No data for this provider in the recent period." });
  }

  const recent = periodMetrics(recentRows, kpiSettings);
  const prior = priorRows.length ? periodMetrics(priorRows, kpiSettings) : null;

  const metricDefs = [
    { key: "avgTpsh", label: "TPSH", weight: 0.24, better: "higher" },
    { key: "avgOtp", label: "OTP", weight: 0.24, better: "higher" },
    { key: "avgShf", label: "Fulfillment (SHF)", weight: 0.2, better: "higher" },
    { key: "avgLateFirst", label: "Late to First", weight: 0.12, better: "lower" },
    { key: "avgRouteClosures", label: "Partial Closures", weight: 0.12, better: "lower" },
  ];

  const metrics = metricDefs.map((def) => {
    const recentVal = safeMean(recent.rankings.map((r) => r[def.key]));
    const priorVal = prior ? safeMean(prior.rankings.map((r) => r[def.key])) : null;
    let trend = "Insufficient Data";
    if (recentVal != null && priorVal != null) {
      const delta = def.better === "higher" ? recentVal - priorVal : priorVal - recentVal;
      const tolerance = def.key === "avgTpsh" ? 0.02 : 0.01;
      trend = delta > tolerance ? "Improving" : delta < -tolerance ? "Deteriorating" : "Stable";
    }
    return { ...def, recentVal: round2(recentVal), priorVal: round2(priorVal), trend };
  });

  const improving = metrics.filter((m) => m.trend === "Improving").length;
  const deteriorating = metrics.filter((m) => m.trend === "Deteriorating").length;
  let status = "MIXED-STABLE";
  if (improving > deteriorating && improving >= Math.ceil(metrics.length / 2)) status = "IMPROVING";
  else if (deteriorating > improving && deteriorating >= Math.ceil(metrics.length / 2)) status = "DETERIORATING";
  else if (improving === 0 && deteriorating === 0) status = "NOT DEMONSTRATING SUSTAINED IMPROVEMENT";

  res.json({
    division: { id: division._id, code: division.code, name: division.name },
    provider,
    note,
    recentPeriod: { from: iso(recentFrom), to: iso(recentTo) },
    priorPeriod: prior ? { from: iso(priorFrom), to: iso(priorTo) } : null,
    status,
    metrics,
    operatorRows: computeRankings(routeDailyData(recentRows), kpiSettings, ["provider", "route", "operator"]),
    summary: recent.summary,
  });
};
