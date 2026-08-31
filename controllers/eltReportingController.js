import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { divisionFilter } from "../middleware/access.js";
import { addDays, emptyMetrics, accumulate, coveragePct, runCutFulfillmentPct } from "../utils/weeklyMetrics.js";
import { buildTrackerRows } from "../utils/kpi/trackerRows.js";
import { routeDailyData, computeRankings } from "../utils/kpi/rankings.js";
import { getEffectiveKpiSettings } from "../utils/kpi/settings.js";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
// Percentages stay raw fractions (0-1) in the API response, matching every
// other controller in the app (homeSummaryController, trackerController) —
// the frontend formats them for display. Only the file exports below turn
// these into human-readable "84.6%" strings.
const roundFrac = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);
const safeMean = (values) => {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

// runCutFulfillmentPct/coveragePct default to 0 when nothing was scheduled
// at all (see weeklyMetrics.js) — fine for a live dashboard, but a "0%"
// caused by an empty period reads as a real (and misleading) prior-period
// comparison point here, so treat "nothing scheduled" as no data instead.
const fulfillmentOrNull = (metrics) => ({
  runCutFulfillmentPct: metrics.dutiesScheduled ? roundFrac(runCutFulfillmentPct(metrics)) : null,
  revenueHourFulfillmentPct: metrics.revenueHoursScheduled ? roundFrac(coveragePct(metrics)) : null,
});

const parseDivisionIds = (raw) => (raw ? String(raw).split(",").filter(Boolean) : null);

// Groups the flat, cross-division rcd/daily-row lists into per-bucket
// fulfillment/OTP numbers for the trend chart. Daily buckets stay readable
// up to 6 weeks; beyond that the chart would be too dense, so it switches
// to weekly buckets instead.
const buildTrend = (from, to, allRunCutDays, allDailyRows) => {
  const spanDays = Math.round((to - from) / 86400000) + 1;
  const byWeek = spanDays > 42;

  const bucketKey = (date) => {
    if (!byWeek) return iso(date);
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return iso(d);
  };

  const buckets = new Map();
  const getBucket = (key) => {
    if (!buckets.has(key)) buckets.set(key, { metrics: emptyMetrics(), otpValues: [] });
    return buckets.get(key);
  };

  allRunCutDays.forEach((rcd) => {
    if (rcd.route?.type === "standby") return;
    accumulate(getBucket(bucketKey(rcd.date)).metrics, rcd);
  });
  allDailyRows.forEach((row) => {
    if (row.otp != null) getBucket(bucketKey(row.date)).otpValues.push(row.otp);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucketStart, bucket]) => ({
      bucketStart,
      ...fulfillmentOrNull(bucket.metrics),
      avgOtp: roundFrac(safeMean(bucket.otpValues)),
    }));
};

// The full cross-division, cross-section rollup for one date window —
// shared by the on-screen report and every export format.
const computeReport = async (req, from, to, divisionIds) => {
  const filter = { ...divisionFilter(req.user), active: true };
  if (divisionIds?.length) filter._id = { $in: divisionIds };
  const divisions = await Division.find(filter).sort({ code: 1 });

  const allRunCutDays = [];
  const allDailyRows = [];
  const allIssues = [];
  const allBelowTargetProviders = [];

  const perDivision = await Promise.all(
    divisions.map(async (division) => {
      const [runCutDays, issues, unassignedRunCuts, kpiSettings, rows] = await Promise.all([
        RunCutDay.find({ division: division._id, date: { $gte: from, $lte: to } }).populate("route", "type"),
        DailyIssueLog.find({ division: division._id, date: { $gte: from, $lte: to } }).populate("route", "code"),
        RunCut.find({ division: division._id, status: "unassigned" }).populate("route", "code type"),
        getEffectiveKpiSettings(division),
        buildTrackerRows(division._id, from, to),
      ]);

      allRunCutDays.push(...runCutDays);

      const metrics = emptyMetrics();
      runCutDays.forEach((rcd) => {
        if (rcd.route?.type === "standby") return;
        accumulate(metrics, rcd);
      });

      const daily = routeDailyData(rows);
      allDailyRows.push(...daily);

      const providerRankings = computeRankings(daily, kpiSettings, ["provider"]);
      const belowTargetProviders = providerRankings
        .filter((r) => !r.meetsOtp || !r.meetsShf || !r.meetsTpsh)
        .map((r) => ({
          divisionId: division._id,
          divisionName: division.name,
          provider: r.provider,
          failedKpis: r.failedKpis,
          composite: r.composite,
        }));
      allBelowTargetProviders.push(...belowTargetProviders);

      const serviceRows = daily.filter((r) => !r.isClosureOnly);
      const totalTrips = daily.reduce((s, r) => s + r.totalTrips, 0);
      const totalActualHrs = daily.reduce((s, r) => s + r.actualHrs, 0);
      const totalSchedHrs = daily.reduce((s, r) => s + r.schedHrs, 0);

      const unassignedRoutes = unassignedRunCuts
        .filter((rc) => rc.route && rc.route.type !== "standby")
        .map((rc) => ({ routeId: rc.route._id, routeCode: rc.route.code }));

      const divIssues = issues.map((i) => ({
        issueId: i._id,
        divisionId: division._id,
        divisionName: division.name,
        date: iso(i.date),
        routeCode: i.route?.code || null,
        disruptionType: i.disruptionType,
        notes: i.notes,
      }));
      allIssues.push(...divIssues);

      return {
        divisionId: division._id,
        code: division.code,
        name: division.name,
        ...fulfillmentOrNull(metrics),
        revenueHoursScheduled: round2(metrics.revenueHoursScheduled),
        revenueHoursCovered: round2(metrics.revenueHoursCovered),
        revenueHoursAtRisk: round2(metrics.revenueHoursScheduled - metrics.revenueHoursCovered),
        avgOtp: roundFrac(safeMean(serviceRows.map((r) => r.otp))),
        avgShf: totalSchedHrs > 0 ? roundFrac(totalActualHrs / totalSchedHrs) : null,
        avgTpsh: totalActualHrs > 0 ? round2(totalTrips / totalActualHrs) : null,
        totalTrips,
        totalClosures: daily.reduce((s, r) => s + r.routeClosures, 0),
        totalLateFirst: daily.reduce((s, r) => s + r.lateToFirst, 0),
        totalLateDeploy: daily.reduce((s, r) => s + r.lateDeploy, 0),
        unassignedRoutesCount: unassignedRoutes.length,
        unassignedRoutes,
        belowTargetProviders,
        issueCount: divIssues.length,
      };
    })
  );

  const combinedMetrics = perDivision.reduce((acc, d) => {
    acc.revenueHoursScheduled += d.revenueHoursScheduled || 0;
    acc.revenueHoursCovered += d.revenueHoursCovered || 0;
    return acc;
  }, { revenueHoursScheduled: 0, revenueHoursCovered: 0 });

  const netServiceRows = allDailyRows.filter((r) => !r.isClosureOnly);
  const netTotalTrips = allDailyRows.reduce((s, r) => s + r.totalTrips, 0);
  const netTotalActualHrs = allDailyRows.reduce((s, r) => s + r.actualHrs, 0);
  const netTotalSchedHrs = allDailyRows.reduce((s, r) => s + r.schedHrs, 0);
  const netMetrics = emptyMetrics();
  allRunCutDays.forEach((rcd) => {
    if (rcd.route?.type === "standby") return;
    accumulate(netMetrics, rcd);
  });

  const networkSummary = {
    ...fulfillmentOrNull(netMetrics),
    revenueHoursAtRisk: round2(combinedMetrics.revenueHoursScheduled - combinedMetrics.revenueHoursCovered),
    avgOtp: roundFrac(safeMean(netServiceRows.map((r) => r.otp))),
    avgShf: netTotalSchedHrs > 0 ? roundFrac(netTotalActualHrs / netTotalSchedHrs) : null,
    avgTpsh: netTotalActualHrs > 0 ? round2(netTotalTrips / netTotalActualHrs) : null,
    totalTrips: netTotalTrips,
    totalClosures: allDailyRows.reduce((s, r) => s + r.routeClosures, 0),
    totalLateFirst: allDailyRows.reduce((s, r) => s + r.lateToFirst, 0),
    totalLateDeploy: allDailyRows.reduce((s, r) => s + r.lateDeploy, 0),
    unassignedRoutesCount: perDivision.reduce((s, d) => s + d.unassignedRoutesCount, 0),
    providersFailingOtp: allBelowTargetProviders.filter((p) => p.failedKpis.includes("OTP")).length,
    providersFailingShf: allBelowTargetProviders.filter((p) => p.failedKpis.includes("SHF")).length,
    providersFailingTpsh: allBelowTargetProviders.filter((p) => p.failedKpis.includes("TPSH")).length,
  };

  return {
    from: iso(from),
    to: iso(to),
    networkSummary,
    divisions: perDivision,
    trend: buildTrend(from, to, allRunCutDays, allDailyRows),
    providersBelowTarget: allBelowTargetProviders.sort((a, b) => (a.composite ?? 0) - (b.composite ?? 0)),
    issues: allIssues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
};

const resolveRange = (query) => {
  const { from, to, divisions: divisionsParam } = query;
  if (!from || !to) return { error: "from and to are required" };
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const spanDays = Math.round((toDate - fromDate) / 86400000) + 1;
  const priorTo = addDays(fromDate, -1);
  const priorFrom = addDays(priorTo, -(spanDays - 1));
  return { fromDate, toDate, priorFrom, priorTo, divisionIds: parseDivisionIds(divisionsParam) };
};

export const getEltReport = async (req, res) => {
  const { error, fromDate, toDate, priorFrom, priorTo, divisionIds } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const comparePrior = req.query.comparePrior !== "0";

  const [current, prior] = await Promise.all([
    computeReport(req, fromDate, toDate, divisionIds),
    comparePrior ? computeReport(req, priorFrom, priorTo, divisionIds) : Promise.resolve(null),
  ]);

  res.json({
    ...current,
    priorFrom: prior ? iso(priorFrom) : null,
    priorTo: prior ? iso(priorTo) : null,
    priorNetworkSummary: prior?.networkSummary || null,
  });
};

const REPORT_HEADERS = {
  summary: ["Metric", "Value"],
  divisions: [
    "Division",
    "Run Cut Fulfillment %",
    "Revenue Hour Fulfillment %",
    "Revenue Hours At Risk",
    "Avg OTP %",
    "Avg SHF %",
    "Avg TPSH",
    "Total Trips",
    "Closures",
    "Late to First",
    "Late Deploy",
    "Unassigned Routes",
  ],
  providers: ["Division", "Provider", "Failed KPIs", "Composite Score"],
  issues: ["Division", "Date", "Route", "Disruption", "Notes"],
};

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Exports are the one place these fractions become human-readable "84.6%"
// strings — the JSON API keeps raw 0-1 fractions for the frontend to format.
const fmtPct = (n) => (n == null ? "" : `${Math.round(n * 1000) / 10}%`);

const toRows = (report) => ({
  summary: [
    ["Date range", `${report.from} to ${report.to}`],
    ["Run Cut Fulfillment %", fmtPct(report.networkSummary.runCutFulfillmentPct)],
    ["Revenue Hour Fulfillment %", fmtPct(report.networkSummary.revenueHourFulfillmentPct)],
    ["Revenue Hours At Risk", report.networkSummary.revenueHoursAtRisk],
    ["Avg OTP %", fmtPct(report.networkSummary.avgOtp)],
    ["Avg SHF %", fmtPct(report.networkSummary.avgShf)],
    ["Avg TPSH", report.networkSummary.avgTpsh],
    ["Total Trips", report.networkSummary.totalTrips],
    ["Total Closures", report.networkSummary.totalClosures],
    ["Unassigned Routes", report.networkSummary.unassignedRoutesCount],
    ["Providers Failing OTP", report.networkSummary.providersFailingOtp],
    ["Providers Failing SHF", report.networkSummary.providersFailingShf],
    ["Providers Failing TPSH", report.networkSummary.providersFailingTpsh],
  ],
  divisions: report.divisions.map((d) => [
    d.name,
    fmtPct(d.runCutFulfillmentPct),
    fmtPct(d.revenueHourFulfillmentPct),
    d.revenueHoursAtRisk,
    fmtPct(d.avgOtp),
    fmtPct(d.avgShf),
    d.avgTpsh,
    d.totalTrips,
    d.totalClosures,
    d.totalLateFirst,
    d.totalLateDeploy,
    d.unassignedRoutesCount,
  ]),
  providers: report.providersBelowTarget.map((p) => [
    p.divisionName,
    p.provider,
    p.failedKpis.join(", "),
    p.composite,
  ]),
  issues: report.issues.map((i) => [i.divisionName, i.date, i.routeCode || "", i.disruptionType, i.notes || ""]),
});

export const exportEltReport = async (req, res) => {
  const { error, fromDate, toDate, divisionIds } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const report = await computeReport(req, fromDate, toDate, divisionIds);
  const rows = toRows(report);
  const format = ["xlsx", "csv", "pdf"].includes(req.query.format) ? req.query.format : "xlsx";
  const filenameBase = `ELT-Report-${report.from}-to-${report.to}`;

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([REPORT_HEADERS.summary, ...rows.summary]), "Summary");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([REPORT_HEADERS.divisions, ...rows.divisions]),
      "Per-Division"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([REPORT_HEADERS.providers, ...rows.providers]),
      "Provider Performance"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([REPORT_HEADERS.issues, ...rows.issues]), "Issues");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  if (format === "csv") {
    const sections = [
      ["SUMMARY"],
      REPORT_HEADERS.summary,
      ...rows.summary,
      [],
      ["PER-DIVISION"],
      REPORT_HEADERS.divisions,
      ...rows.divisions,
      [],
      ["PROVIDER PERFORMANCE"],
      REPORT_HEADERS.providers,
      ...rows.providers,
      [],
      ["ISSUES"],
      REPORT_HEADERS.issues,
      ...rows.issues,
    ];
    const csv = sections.map((r) => r.map(escapeCsv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
    return res.send(csv);
  }

  // pdf — a condensed version of the same data (the full column set is in
  // the xlsx/csv exports); columns are sized to fit letter-width with a
  // 40pt margin (532pt usable) and row height is measured per-row so
  // wrapped header/cell text never overlaps the next row.
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  const doc = new PDFDocument({ margin: 40, size: "letter" });
  doc.pipe(res);

  doc.fontSize(18).text("ELT Operations Report", { align: "left" });
  doc.fontSize(11).fillColor("#666").text(`${report.from} to ${report.to}`);
  doc.moveDown();

  // doc.x does NOT reset to the page's left margin after an explicit-
  // position .text(str, x, y, {...}) call — it's left at wherever that call
  // drew, which drifted every subsequent table further right off the page.
  // Always anchor tables to the real margin instead of trusting doc.x.
  const pageLeft = doc.page.margins.left;

  const rowHeight = (cells, colWidths, fontSize) =>
    Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ""), { width: colWidths[i] }))) + fontSize * 0.6;

  const drawRow = (cells, colWidths, startX, y, fontSize) => {
    cells.forEach((c, i) => {
      doc.text(String(c ?? ""), startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
    });
  };

  const drawTable = (title, headers, tableRows, colWidths) => {
    doc.x = pageLeft;
    doc.fillColor("#000").fontSize(13).text(title, pageLeft, doc.y);
    doc.moveDown(0.3);
    const startX = pageLeft;
    let y = doc.y;

    doc.fontSize(8).fillColor("#333");
    const headerHeight = rowHeight(headers, colWidths, 8);
    drawRow(headers, colWidths, startX, y, 8);
    y += headerHeight;

    doc.fontSize(9).fillColor("#000");
    if (tableRows.length === 0) {
      doc.text("None", startX, y);
      y += 14;
    }
    tableRows.forEach((row) => {
      const h = rowHeight(row, colWidths, 9);
      if (y + h > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      drawRow(row, colWidths, startX, y, 9);
      y += h;
    });
    doc.y = y + 12;
  };

  drawTable("Executive Summary", REPORT_HEADERS.summary, rows.summary, [200, 200]);

  const pdfDivisionHeaders = ["Division", "Run Cut Fulfill.", "Rev. Hr Fulfill.", "Hrs At Risk", "OTP", "SHF", "TPSH", "Unassigned"];
  const pdfDivisionRows = report.divisions.map((d) => [
    d.name,
    fmtPct(d.runCutFulfillmentPct),
    fmtPct(d.revenueHourFulfillmentPct),
    d.revenueHoursAtRisk,
    fmtPct(d.avgOtp),
    fmtPct(d.avgShf),
    d.avgTpsh,
    d.unassignedRoutesCount,
  ]);
  drawTable("Per-Division", pdfDivisionHeaders, pdfDivisionRows, [130, 65, 65, 60, 42, 42, 48, 65]);

  doc.addPage();
  drawTable("Provider Performance", REPORT_HEADERS.providers, rows.providers, [130, 150, 170, 60]);
  drawTable("Issues", REPORT_HEADERS.issues, rows.issues, [110, 60, 60, 100, 190]);

  doc.end();
};
