import DailyKpiEntry from "../../models/DailyKpiEntry.js";
import RunCutDay from "../../models/RunCutDay.js";
import DailyIssueLog from "../../models/DailyIssueLog.js";
import { normalizeRouteGroup } from "./routeFamily.js";

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const rowKey = (routeId, date) => `${routeId}|${dateKey(date)}`;

// The "derive, don't re-enter" merge: joins the minimal uploaded KPI entries
// (date, route, actual hours, total trips, OTP%) against Master Run Cuts
// (operator + scheduled hours) and Deployment's issue log (closures / late
// events) so every KPI calculation sees the same full row shape the R app's
// Daily Tracker workbook had, without any of it being re-typed.
export const buildTrackerRows = async (division, from, to) => {
  const dateFilter = { $gte: new Date(from), $lte: new Date(to) };

  const [entries, runCutDays, issues] = await Promise.all([
    DailyKpiEntry.find({ division, date: dateFilter }).populate("route", "code"),
    RunCutDay.find({ division, date: dateFilter })
      .populate("route", "code")
      .populate({ path: "operator", populate: { path: "provider", select: "name" } }),
    DailyIssueLog.find({ division, date: dateFilter }).populate("route", "code"),
  ]);

  const runCutDayMap = new Map();
  for (const rcd of runCutDays) {
    if (!rcd.route) continue;
    runCutDayMap.set(rowKey(rcd.route._id, rcd.date), rcd);
  }

  const issueCounts = new Map();
  for (const issue of issues) {
    if (!issue.route) continue;
    const key = rowKey(issue.route._id, issue.date);
    if (!issueCounts.has(key)) issueCounts.set(key, {});
    const bucket = issueCounts.get(key);
    bucket[issue.disruptionType] = (bucket[issue.disruptionType] || 0) + 1;
  }

  return entries
    .filter((entry) => entry.route)
    .map((entry) => {
      const key = rowKey(entry.route._id, entry.date);
      const rcd = runCutDayMap.get(key);
      const bucket = issueCounts.get(key) || {};

      const operatorName = rcd?.operator?.name || "Unassigned";
      const providerName = rcd?.operator?.provider?.name || "Unassigned";
      const statusClosure = rcd?.status === "suspended" ? 1 : 0;
      const issueClosures = (bucket["Unperformed Duty"] || 0) + (bucket["Route Closed"] || 0);

      const routeSource = entry.route.code;
      const route = normalizeRouteGroup(routeSource);

      // Deployment is the authoritative source for closures/late events
      // whenever it has any record of this route/date at all (a RunCutDay
      // exists) - only fall back to the uploaded tracker's own reported
      // values when Deployment has no coverage whatsoever for the day, not
      // merely when it recorded zero incidents.
      const hasDeploymentCoverage = Boolean(rcd);

      return {
        entryId: entry._id.toString(),
        date: dateKey(entry.date),
        operator: operatorName,
        provider: providerName,
        route,
        routeSource,
        schedHrs: rcd?.serviceHours ?? 0,
        actualHrs: entry.actualHours,
        totalTrips: entry.totalTrips,
        otpPct: entry.otpPct,
        routeClosures: hasDeploymentCoverage ? Math.max(statusClosure, issueClosures) : entry.uploadRouteClosures ?? 0,
        lateToFirst: hasDeploymentCoverage ? bucket["Late to First"] || 0 : entry.uploadLateToFirst ?? 0,
        lateDeploy: hasDeploymentCoverage ? bucket["Late Deploy"] || 0 : entry.uploadLateDeploy ?? 0,
        closuresSource: hasDeploymentCoverage ? "deployment" : "upload",
        kpiKey: `${providerName.toLowerCase()}|${route.toLowerCase()}`,
      };
    });
};
