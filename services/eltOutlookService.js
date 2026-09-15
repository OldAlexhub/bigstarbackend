import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Division from "../models/Division.js";
import EltOutlookSnapshot from "../models/EltOutlookSnapshot.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import RunCutDay from "../models/RunCutDay.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import { defaultKpiSetting } from "../utils/operationsKpis.js";
import { isCovered } from "../utils/hours.js";
import { addDays, startOfWeek } from "../utils/weeklyMetrics.js";
import {
  OUTLOOK_METRICS,
  OUTLOOK_MODEL_VERSION,
  deriveOutlookSignals,
  evaluateForecast,
  robustDirection,
  weightedValue,
} from "../utils/eltOutlookAnalytics.js";

const DAY = 86400000;
const CLOSURE_TYPES = new Set(["Unperformed Duty", "Route Closed"]);
const id = (value) => String(value?._id || value || "");
const iso = (value) => new Date(value).toISOString().slice(0, 10);
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;
const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
export const outlookMonthOf = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  const text = String(value || "");
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : new Date(value).toISOString().slice(0, 7);
};
const monthOf = outlookMonthOf;

const monthStart = (month) => new Date(`${month}-01T00:00:00.000Z`);
const addMonths = (month, amount) => {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
};
const monthEndDate = (month) => {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date;
};
const monthEnd = (month) => iso(monthEndDate(month));

const weekPeriods = (from, cutoff) => {
  const periods = [];
  for (let cursor = startOfWeek(from); addDays(cursor, 6) <= cutoff; cursor = addDays(cursor, 7)) {
    periods.push({ period: iso(cursor), from: cursor, to: addDays(cursor, 6) });
  }
  return periods;
};

const monthPeriods = (fromMonth, cutoff) => {
  const periods = [];
  for (let cursor = fromMonth; monthEndDate(cursor) <= cutoff; cursor = addMonths(cursor, 1)) {
    periods.push({ period: cursor, from: monthStart(cursor), to: monthEndDate(cursor) });
  }
  return periods;
};

const metricResult = (value, numerator = null, denominator = null, observed = 0) => ({
  value: round(value, 6),
  numerator: finite(numerator),
  denominator: finite(denominator),
  observed,
});

const isGoLink = (division) => {
  const normalized = `${division.code || ""}${division.name || ""}`.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return normalized.includes("GOLINK") || normalized.includes("DIV3GL");
};

const loadSourceData = async (divisions, cutoff) => {
  const divisionIds = divisions.map((division) => division._id);
  const historyMonth = addMonths(monthOf(cutoff), -31);
  const historyFrom = monthStart(historyMonth);
  const [runCutDays, networkEntries, issues, safetyEntries, safetyScores, customerEntries, settings] = await Promise.all([
    RunCutDay.find({ division: { $in: divisionIds }, date: { $gte: historyFrom, $lte: cutoff } })
      .populate("route", "code type").lean(),
    NetworkKpiEntry.find({ division: { $in: divisionIds }, date: { $gte: iso(historyFrom), $lte: iso(cutoff) } })
      .select("division date route metrics deployment").populate("route", "code type").lean(),
    DailyIssueLog.find({ division: { $in: divisionIds }, date: { $gte: historyFrom, $lte: cutoff } })
      .select("division date route disruptionType").populate("route", "code").lean(),
    SafetyEntry.find({ division: { $in: divisionIds }, month: { $gte: historyMonth, $lte: monthOf(cutoff) } }).lean(),
    SafetyScoreEntry.find({ division: { $in: divisionIds }, month: { $gte: historyMonth, $lte: monthOf(cutoff) } }).lean(),
    CustomerServiceEntry.find({ division: { $in: divisionIds }, month: { $gte: historyMonth, $lte: monthOf(cutoff) } }).lean(),
    OperationsKpiSetting.find({ division: { $in: divisionIds }, effectiveMonth: { $lte: monthOf(cutoff) } }).lean(),
  ]);
  return { historyFrom, runCutDays, networkEntries, issues, safetyEntries, safetyScores, customerEntries, settings };
};

const rowsInRange = (rows, from, to, dateFor = (row) => row.date) => rows.filter((row) => {
  const date = new Date(dateFor(row));
  return date >= from && date <= to;
});

const monthlyRows = (rows, from, to, monthlyAtEnd) => rows.filter((row) => {
  if (monthlyAtEnd) {
    const end = monthEndDate(row.month);
    return end >= from && end <= to;
  }
  return row.month >= monthOf(from) && row.month <= monthOf(to);
});

const buildFullMonthTrips = (networkEntries) => {
  const result = new Map();
  for (const entry of networkEntries) {
    const key = `${id(entry.division)}|${monthOf(entry.date)}`;
    const trips = Math.max(0, finite(entry.metrics?.completedTrips) || 0);
    result.set(key, (result.get(key) || 0) + trips);
  }
  return result;
};

const calculateRange = (data, divisions, from, to, { monthlyAtEnd = false } = {}) => {
  const divisionIds = new Set(divisions.map((division) => id(division)));
  const goLinkIds = new Set(divisions.filter(isGoLink).map((division) => id(division)));
  const runCutDays = rowsInRange(data.runCutDays, from, to).filter((row) => divisionIds.has(id(row.division)));
  const networkEntries = data.networkEntries.filter((row) => divisionIds.has(id(row.division)) && row.date >= iso(from) && row.date <= iso(to));
  const issues = rowsInRange(data.issues, from, to).filter((row) => divisionIds.has(id(row.division)));
  const safetyEntries = monthlyRows(data.safetyEntries.filter((row) => divisionIds.has(id(row.division))), from, to, monthlyAtEnd);
  const safetyScores = monthlyRows(data.safetyScores.filter((row) => divisionIds.has(id(row.division))), from, to, monthlyAtEnd);
  const customerEntries = monthlyRows(data.customerEntries.filter((row) => divisionIds.has(id(row.division))), from, to, monthlyAtEnd);

  let dutiesScheduled = 0;
  let dutiesDeployed = 0;
  let revenueScheduled = 0;
  let revenueCovered = 0;
  let standbyAvailable = 0;
  let standbyDeployed = 0;
  const runDayByRouteDate = new Map();
  const closureKeys = new Set();
  for (const day of runCutDays) {
    const routeId = id(day.route);
    runDayByRouteDate.set(`${id(day.division)}|${routeId}|${iso(day.date)}`, day);
    if (day.route?.type === "standby") {
      if (day.status === "active") {
        standbyAvailable += 1;
        if (day.deployed) standbyDeployed += 1;
      }
      continue;
    }
    if (day.status !== "off") {
      dutiesScheduled += 1;
      revenueScheduled += finite(day.revenueHours) || 0;
    }
    if (day.status === "active") dutiesDeployed += 1;
    if (isCovered(day.status)) revenueCovered += finite(day.revenueHours) || 0;
    if (day.status === "suspended") closureKeys.add(`${id(day.division)}|${routeId}|${iso(day.date)}`);
  }

  let completedTrips = 0;
  let tpshTrips = 0;
  let tpshHours = 0;
  let otpWeighted = 0;
  let otpTrips = 0;
  let goLinkOtpWeighted = 0;
  let goLinkOtpTrips = 0;
  let actualRevenue = 0;
  let matchedPlannedRevenue = 0;
  let actualObserved = 0;
  const operatingDates = new Set();
  for (const entry of networkEntries) {
    const trips = Math.max(0, finite(entry.metrics?.completedTrips) || 0);
    completedTrips += trips;
    if (finite(entry.metrics?.completedTrips) !== null) operatingDates.add(`${id(entry.division)}|${entry.date}`);

    const serviceHours = finite(entry.metrics?.reportedServiceHours);
    const entryTpsh = finite(entry.metrics?.tpsh);
    const usableHours = serviceHours > 0 ? serviceHours : trips > 0 && entryTpsh > 0 ? trips / entryTpsh : null;
    if (usableHours > 0) {
      tpshTrips += trips;
      tpshHours += usableHours;
    }

    const otp = finite(entry.metrics?.otpPct);
    if (trips > 0 && otp !== null) {
      otpWeighted += otp * trips;
      otpTrips += trips;
      if (goLinkIds.has(id(entry.division))) {
        goLinkOtpWeighted += otp * trips;
        goLinkOtpTrips += trips;
      }
    }

    const actual = finite(entry.metrics?.reportedRevenueHours);
    if (actual !== null) {
      actualObserved += 1;
      const runDay = runDayByRouteDate.get(`${id(entry.division)}|${id(entry.route)}|${entry.date}`);
      const planned = finite(entry.deployment?.scheduledRevenueHours) ?? finite(runDay?.revenueHours);
      if (planned !== null) {
        actualRevenue += actual;
        matchedPlannedRevenue += planned;
      }
    }
  }

  let lateToFirst = 0;
  let lateDeploy = 0;
  for (const issue of issues) {
    if (CLOSURE_TYPES.has(issue.disruptionType) && issue.route) {
      closureKeys.add(`${id(issue.division)}|${id(issue.route)}|${iso(issue.date)}`);
    }
    if (issue.disruptionType === "Late to First") lateToFirst += 1;
    if (issue.disruptionType === "Late Deploy") lateDeploy += 1;
  }

  let safetyMiles = 0;
  let preventableAccidents = 0;
  const safetyByKey = new Map();
  for (const entry of safetyEntries) {
    const miles = finite(entry.miles);
    const preventable = finite(entry.preventableAccidents);
    safetyByKey.set(`${id(entry.division)}|${entry.month}`, entry);
    if (miles !== null && preventable !== null) {
      safetyMiles += miles;
      preventableAccidents += preventable;
    }
  }
  let scoreWeighted = 0;
  let scoreMiles = 0;
  for (const entry of safetyScores) {
    const score = finite(entry.score);
    const miles = finite(safetyByKey.get(`${id(entry.division)}|${entry.month}`)?.miles);
    if (score !== null && miles > 0) {
      scoreWeighted += score * miles;
      scoreMiles += miles;
    }
  }

  let matchedComplaints = 0;
  let complaintTrips = 0;
  let customerMatchedMonths = 0;
  for (const entry of customerEntries) {
    const complaints = finite(entry.complaints);
    const trips = data.fullMonthTrips.get(`${id(entry.division)}|${entry.month}`) || 0;
    if (complaints !== null && trips > 0) {
      matchedComplaints += complaints;
      complaintTrips += trips;
      customerMatchedMonths += 1;
    }
  }

  const hasOperationalEvidence = runCutDays.length > 0 || networkEntries.length > 0;
  return {
    runCutFulfillment: metricResult(weightedValue(dutiesDeployed, dutiesScheduled), dutiesDeployed, dutiesScheduled, runCutDays.length),
    plannedRevenueHourFulfillment: metricResult(weightedValue(revenueCovered, revenueScheduled), revenueCovered, revenueScheduled, runCutDays.length),
    actualRevenueHourFulfillment: metricResult(weightedValue(actualRevenue, matchedPlannedRevenue), actualRevenue, matchedPlannedRevenue, actualObserved),
    revenueHoursAtRisk: metricResult(revenueScheduled > 0 ? revenueScheduled - revenueCovered : null, revenueScheduled - revenueCovered, revenueScheduled, runCutDays.length),
    completedTrips: metricResult(networkEntries.length ? completedTrips : null, completedTrips, null, networkEntries.length),
    tripsPerOperatingDay: metricResult(weightedValue(completedTrips, operatingDates.size), completedTrips, operatingDates.size, operatingDates.size),
    tpsh: metricResult(weightedValue(tpshTrips, tpshHours), tpshTrips, tpshHours, networkEntries.length),
    otp: metricResult(weightedValue(otpWeighted, otpTrips), otpWeighted, otpTrips, networkEntries.length),
    goLinkOtp: metricResult(weightedValue(goLinkOtpWeighted, goLinkOtpTrips), goLinkOtpWeighted, goLinkOtpTrips, goLinkOtpTrips ? networkEntries.length : 0),
    standbyUtilization: metricResult(weightedValue(standbyDeployed, standbyAvailable), standbyDeployed, standbyAvailable, runCutDays.length),
    closures: metricResult(hasOperationalEvidence ? closureKeys.size : null, closureKeys.size, null, hasOperationalEvidence ? 1 : 0),
    lateToFirst: metricResult(hasOperationalEvidence ? lateToFirst : null, lateToFirst, null, hasOperationalEvidence ? 1 : 0),
    lateDeploy: metricResult(hasOperationalEvidence ? lateDeploy : null, lateDeploy, null, hasOperationalEvidence ? 1 : 0),
    safetyScore: metricResult(weightedValue(scoreWeighted, scoreMiles), scoreWeighted, scoreMiles, safetyScores.length),
    preventableAccidentRatio: metricResult(weightedValue(preventableAccidents, safetyMiles, 100000), preventableAccidents, safetyMiles, safetyEntries.length),
    complaintRatio: metricResult(weightedValue(matchedComplaints, complaintTrips, 1000), matchedComplaints, complaintTrips, customerMatchedMonths),
  };
};

const settingLookup = (settings) => {
  const grouped = new Map();
  for (const setting of settings) {
    const key = `${id(setting.division)}|${setting.kpiKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(setting);
  }
  for (const values of grouped.values()) values.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  return (division, key, month) => {
    const values = grouped.get(`${id(division)}|${key}`) || [];
    let result = null;
    for (const value of values) {
      if (value.effectiveMonth <= month) result = value;
      else break;
    }
    return result || defaultKpiSetting(division, key);
  };
};

const targetFor = (definition, divisions, perDivision, getSetting, month) => {
  if (!definition.targetKey) return null;
  const weightedTargets = [];
  for (const division of divisions) {
    const setting = getSetting(division, definition.targetKey, month);
    if (!setting?.enabled) continue;
    const result = perDivision.get(id(division))?.[definition.key];
    const weight = result?.denominator > 0 ? result.denominator : result?.observed > 0 ? result.observed : 1;
    weightedTargets.push({ target: finite(setting.target), weight });
  }
  const available = weightedTargets.filter((item) => item.target !== null && item.weight > 0);
  if (!available.length) return null;
  return round(available.reduce((sum, item) => sum + item.target * item.weight, 0) /
    available.reduce((sum, item) => sum + item.weight, 0), 6);
};

const targetStatus = (value, target, higherIsBetter) => {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return "not_applicable";
  return higherIsBetter ? (value >= target ? "on_target" : "attention") : (value <= target ? "on_target" : "attention");
};

const metricDriver = (definition, divisions, perDivision, data, currentFrom, cutoff) => {
  if (divisions.length > 1) {
    const ranked = divisions
      .map((division) => ({ division, value: perDivision.get(id(division))?.[definition.key]?.value }))
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => definition.higherIsBetter ? a.value - b.value : b.value - a.value);
    if (!ranked.length) return [];
    return [`${ranked[0].division.name} is the largest current watch-point in this company rollup.`];
  }

  const division = divisions[0];
  if (!division) return [];
  const divisionId = id(division);
  if (!Number.isFinite(perDivision.get(divisionId)?.[definition.key]?.value)) return [];
  if (definition.monthly) {
    return [`${division.name} is the matched division-level source for this monthly indicator.`];
  }
  if (["closures", "lateToFirst", "lateDeploy"].includes(definition.key)) {
    const expectedType = definition.key === "lateToFirst" ? "Late to First" : definition.key === "lateDeploy" ? "Late Deploy" : null;
    const counts = new Map();
    rowsInRange(data.issues, currentFrom, cutoff)
      .filter((issue) => id(issue.division) === divisionId)
      .filter((issue) => expectedType ? issue.disruptionType === expectedType : CLOSURE_TYPES.has(issue.disruptionType))
      .forEach((issue) => {
        const route = issue.route?.code || "Unmatched route";
        counts.set(route, (counts.get(route) || 0) + 1);
      });
    const leader = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (leader) return [`Route ${leader[0]} has the highest event count (${leader[1]}) in the selected period.`];
  }
  if (definition.key === "revenueHoursAtRisk") {
    const risk = new Map();
    rowsInRange(data.runCutDays, currentFrom, cutoff)
      .filter((day) => id(day.division) === divisionId && day.route?.type !== "standby" && day.status !== "off" && !isCovered(day.status))
      .forEach((day) => risk.set(day.route?.code || "Unmatched route", (risk.get(day.route?.code || "Unmatched route") || 0) + (finite(day.revenueHours) || 0)));
    const leader = [...risk.entries()].sort((a, b) => b[1] - a[1])[0];
    if (leader) return [`Route ${leader[0]} contributes the most revenue hours at risk (${round(leader[1], 2)} hours).`];
  }
  const volume = new Map();
  data.networkEntries
    .filter((entry) => id(entry.division) === divisionId && entry.date >= iso(currentFrom) && entry.date <= iso(cutoff))
    .forEach((entry) => {
      const label = entry.deployment?.providerName || entry.route?.code || "Unmatched provider/route";
      volume.set(label, (volume.get(label) || 0) + (finite(entry.metrics?.completedTrips) || 0));
    });
  const leader = [...volume.entries()].sort((a, b) => b[1] - a[1])[0];
  return leader
    ? [`${leader[0]} has the largest matched operating volume (${round(leader[1], 0)} completed trips).`]
    : [`${division.name} has no route/provider attribution available for this metric in the selected period.`];
};

const methodology = {
  runCutFulfillment: "Deployed scheduled duties divided by scheduled duties.",
  plannedRevenueHourFulfillment: "Covered scheduled revenue hours divided by scheduled revenue hours.",
  actualRevenueHourFulfillment: "Reported revenue hours divided by planned hours for matched route-days only.",
  revenueHoursAtRisk: "Scheduled revenue hours not covered by an active or added route.",
  completedTrips: "Sum of reported completed trips.",
  tripsPerOperatingDay: "Completed trips divided by distinct reporting days.",
  tpsh: "Completed trips divided by matched reported service hours.",
  otp: "Completed-trip weighted OTP.",
  goLinkOtp: "Completed-trip weighted OTP for GO LINK divisions only.",
  standbyUtilization: "Deployed standby duties divided by available active standby duties.",
  closures: "Unique closed route-days across suspended run cuts and closure issue logs.",
  lateToFirst: "Count of Late to First issue-log events.",
  lateDeploy: "Count of Late Deploy issue-log events.",
  safetyScore: "Mileage-weighted safety score for matched division-months.",
  preventableAccidentRatio: "Preventable accidents per 100,000 reported miles.",
  complaintRatio: "Complaints per 1,000 completed trips for matched division-months.",
};

export const computeEltOutlook = async ({ divisions, cutoff, reportingLevel = divisions.length === 1 ? "division" : "company" }) => {
  const normalizedCutoff = new Date(cutoff);
  normalizedCutoff.setUTCHours(23, 59, 59, 999);
  const currentFrom = addDays(new Date(Date.UTC(
    normalizedCutoff.getUTCFullYear(), normalizedCutoff.getUTCMonth(), normalizedCutoff.getUTCDate()
  )), -89);
  const data = await loadSourceData(divisions, normalizedCutoff);
  data.fullMonthTrips = buildFullMonthTrips(data.networkEntries);
  const current = calculateRange(data, divisions, currentFrom, normalizedCutoff);
  const perDivision = new Map(divisions.map((division) => [
    id(division),
    calculateRange(data, [division], currentFrom, normalizedCutoff),
  ]));

  const weekly = weekPeriods(data.historyFrom, normalizedCutoff).map((period) => ({
    ...period,
    metrics: calculateRange(data, divisions, period.from, period.to, { monthlyAtEnd: true }),
  }));
  const months = monthPeriods(monthOf(data.historyFrom), normalizedCutoff).map((period) => ({
    ...period,
    metrics: calculateRange(data, divisions, period.from, period.to),
  }));
  const recentWeekly = weekly.filter((period) => period.to >= currentFrom);
  const getSetting = settingLookup(data.settings);

  const metrics = OUTLOOK_METRICS.map((definition) => {
    const directionSeries = recentWeekly.map((period) => ({
      period: period.period,
      value: period.metrics[definition.key].value,
      complete: Number.isFinite(period.metrics[definition.key].value),
    }));
    const weeklySeries = weekly.map((period) => ({ period: period.period, value: period.metrics[definition.key].value }));
    const monthlySeries = months.map((period) => ({ period: period.period, value: period.metrics[definition.key].value }));
    const target = targetFor(definition, divisions, perDivision, getSetting, monthOf(normalizedCutoff));
    const value = current[definition.key].value;
    return {
      key: definition.key,
      label: definition.label,
      group: definition.group,
      format: definition.format,
      value,
      numerator: current[definition.key].numerator,
      denominator: current[definition.key].denominator,
      target,
      status: targetStatus(value, target, definition.higherIsBetter),
      direction: robustDirection(directionSeries, definition, recentWeekly.length),
      methodology: methodology[definition.key],
      drivers: metricDriver(definition, divisions, perDivision, data, currentFrom, normalizedCutoff),
      forecasts: {
        "90d": evaluateForecast(weeklySeries, definition, "90d"),
        "12m": evaluateForecast(monthlySeries, { ...definition, monthly: true }, "12m"),
      },
    };
  });

  return {
    reportingLevel,
    division: reportingLevel === "division" ? { id: id(divisions[0]), code: divisions[0].code, name: divisions[0].name } : null,
    dataCutoff: iso(normalizedCutoff),
    currentWindow: { from: iso(currentFrom), to: iso(normalizedCutoff), days: 90 },
    modelVersion: OUTLOOK_MODEL_VERSION,
    framing: "Operational productivity and execution indicators only. This outlook does not calculate or imply revenue, profit, margin, or other financial performance.",
    metrics,
    signals: deriveOutlookSignals(metrics),
  };
};

const snapshotShape = (payload) => ({
  metrics: payload.metrics.map(({ forecasts, ...metric }) => metric),
  readiness: Object.fromEntries(payload.metrics.map((metric) => [metric.key, {
    "90d": { ready: metric.forecasts["90d"].ready, reasons: metric.forecasts["90d"].reasons },
    "12m": { ready: metric.forecasts["12m"].ready, reasons: metric.forecasts["12m"].reasons },
  }])),
  forecasts: Object.fromEntries(payload.metrics.map((metric) => [metric.key, metric.forecasts])),
  errors: Object.fromEntries(payload.metrics.map((metric) => [metric.key, {
    "90d": { model: metric.forecasts["90d"].model, errorType: metric.forecasts["90d"].errorType, error: metric.forecasts["90d"].error, baselineError: metric.forecasts["90d"].baselineError },
    "12m": { model: metric.forecasts["12m"].model, errorType: metric.forecasts["12m"].errorType, error: metric.forecasts["12m"].error, baselineError: metric.forecasts["12m"].baselineError },
  }])),
  drivers: Object.fromEntries(payload.metrics.map((metric) => [metric.key, metric.drivers])),
  signals: payload.signals,
});

export const createEltOutlookSnapshots = async ({ snapshotWeek, dataCutoff, divisionIds = null }) => {
  const divisionFilter = { active: true };
  if (divisionIds?.length) divisionFilter._id = { $in: divisionIds };
  const divisions = await Division.find(divisionFilter).sort({ code: 1 });
  if (!divisions.length) return [];
  const scopes = [{ reportingLevel: "company", division: null, divisions }, ...divisions.map((division) => ({
    reportingLevel: "division", division: division._id, divisions: [division],
  }))];
  const results = [];
  for (const scope of scopes) {
    const query = { reportingLevel: scope.reportingLevel, division: scope.division, snapshotWeek };
    const existing = await EltOutlookSnapshot.findOne(query);
    if (existing) {
      results.push(existing);
      continue;
    }
    const payload = await computeEltOutlook({ divisions: scope.divisions, cutoff: dataCutoff, reportingLevel: scope.reportingLevel });
    const shaped = snapshotShape(payload);
    try {
      results.push(await EltOutlookSnapshot.create({
        ...query,
        dataCutoff,
        modelVersion: OUTLOOK_MODEL_VERSION,
        ...shaped,
      }));
    } catch (error) {
      if (error?.code !== 11000) throw error;
      results.push(await EltOutlookSnapshot.findOne(query));
    }
  }
  return results;
};

export const selectOfficialForecast = (livePayload, snapshot, horizon) => {
  const cutoffAgeDays = snapshot ? Math.floor((new Date(`${livePayload.dataCutoff}T23:59:59.999Z`) - new Date(snapshot.dataCutoff)) / DAY) : null;
  const stale = Boolean(snapshot && cutoffAgeDays > 10);
  const versionMismatch = Boolean(snapshot && snapshot.modelVersion !== livePayload.modelVersion);
  const snapshotStatus = !snapshot
    ? { available: false, stale: false, compatible: false, reason: "No official weekly forecast snapshot is available yet." }
    : stale
      ? { available: true, stale: true, compatible: true, reason: `Official weekly forecast snapshot is stale (data cutoff ${iso(snapshot.dataCutoff)}).` }
      : versionMismatch
        ? { available: true, stale: false, compatible: false, reason: `Official snapshot uses model ${snapshot.modelVersion}; waiting for ${livePayload.modelVersion}.` }
        : { available: true, stale: false, compatible: true, reason: null };
  const metrics = livePayload.metrics.map((metric) => {
    const liveForecast = metric.forecasts[horizon];
    const official = !stale && !versionMismatch ? snapshot?.forecasts?.[metric.key]?.[horizon] : null;
    const unavailable = snapshotStatus.reason || `Official snapshot does not contain ${metric.label || metric.key} for the ${horizon} horizon.`;
    const forecast = official || {
      ...liveForecast,
      ready: false,
      model: null,
      points: [],
      reasons: [
        ...liveForecast.reasons,
        {
          code: stale ? "stale_snapshot" : versionMismatch ? "model_version_mismatch" : snapshot ? "missing_snapshot_metric" : "missing_snapshot",
          message: unavailable,
        },
      ],
    };
    const { forecasts, ...rest } = metric;
    return { ...rest, forecast };
  });
  return {
    ...livePayload,
    horizon,
    metrics,
    snapshot: {
      ...snapshotStatus,
      snapshotWeek: snapshot ? iso(snapshot.snapshotWeek) : null,
      dataCutoff: snapshot ? iso(snapshot.dataCutoff) : null,
      modelVersion: snapshot?.modelVersion || OUTLOOK_MODEL_VERSION,
    },
  };
};

export const latestOutlookSnapshot = ({ division = null }) => EltOutlookSnapshot.findOne({
  reportingLevel: division ? "division" : "company",
  division: division || null,
}).sort({ snapshotWeek: -1 }).lean();
