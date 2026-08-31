import DailyKpiEntry from "../../models/DailyKpiEntry.js";
import Route from "../../models/Route.js";
import { canAccessDivision } from "../../middleware/access.js";
import { parseUploadDate, normalizePercent } from "../../utils/kpi/excelDates.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { parseVisionReport } from "../../utils/kpi/parseVisionReport.js";
import { parseEcolaneReport } from "../../utils/kpi/parseEcolaneReport.js";
import { cleanRunName } from "../../utils/kpi/reportParsing.js";

// Returns the fully-derived Daily Tracker view (same 13 columns as the
// workbook: operator/provider/scheduled hours/closures/late events included)
// even though only date/route/actual hours/trips/OTP were actually entered.
export const listKpiEntries = async (req, res) => {
  const { division, from, to } = req.query;
  if (!division || !from || !to) {
    return res.status(400).json({ message: "division, from, and to are required" });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const rows = await buildTrackerRows(division, from, to);
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.route.localeCompare(b.route)));
  res.json({ rows });
};

export const createKpiEntry = async (req, res) => {
  const { division, route, date, actualHours, totalTrips, otpPct } = req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const entry = await DailyKpiEntry.findOneAndUpdate(
    { division, route, date },
    { division, route, date, actualHours, totalTrips, otpPct, updatedBy: req.user._id },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate("route", "code");
  res.status(201).json({ entry });
};

export const updateKpiEntry = async (req, res) => {
  const entry = await DailyKpiEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Entry not found" });
  if (!canAccessDivision(req.user, entry.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { actualHours, totalTrips, otpPct } = req.body;
  if (actualHours !== undefined) entry.actualHours = actualHours;
  if (totalTrips !== undefined) entry.totalTrips = totalTrips;
  if (otpPct !== undefined) entry.otpPct = otpPct;
  entry.updatedBy = req.user._id;
  await entry.save();
  await entry.populate("route", "code");
  res.json({ entry });
};

export const deleteKpiEntry = async (req, res) => {
  const entry = await DailyKpiEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Entry not found" });
  if (!canAccessDivision(req.user, entry.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  await entry.deleteOne();
  res.json({ message: "Entry deleted" });
};

// Parses a raw operations-system export (Vision: one file; Ecolane: two
// files joined by driver name) into the same {date, route, actualHours,
// totalTrips, otpPct} shape the blank template collects, resolves each
// row's route code against this division, and returns a preview -
// nothing is saved until confirmKpiEntries is called with the (possibly
// hand-edited) rows.
export const preprocessRawReport = async (req, res) => {
  const { division, source } = req.body;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (source !== "vision" && source !== "ecolane") {
    return res.status(400).json({ message: 'source must be "vision" or "ecolane"' });
  }

  const file1 = req.files?.file1?.[0];
  const file2 = req.files?.file2?.[0];
  if (!file1) {
    return res.status(400).json({
      message:
        source === "vision"
          ? "Upload the Vision Para Operations file."
          : "Upload the Daily Run Productivity file.",
    });
  }
  if (source === "ecolane" && !file2) {
    return res.status(400).json({ message: "Upload the Driver Performance file." });
  }

  let parsed;
  try {
    parsed = source === "vision" ? parseVisionReport(file1.buffer) : parseEcolaneReport(file1.buffer, file2.buffer);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not read the uploaded file(s)." });
  }

  // Master Run Cuts route codes in this app keep their "BST" prefix
  // (e.g. "BST1101", "BST-Standby/4501"), but the raw exports' route/run
  // names get that prefix stripped during parsing (cleaning.R's
  // clean_run_name, ported in reportParsing.js) since that's what
  // distinguishes the route from the rest of the cell text. Index routes
  // by both their exact code and BST-stripped code so either form matches.
  const routes = await Route.find({ division });
  const routeByCode = new Map();
  for (const r of routes) {
    routeByCode.set(r.code.trim().toUpperCase(), r);
    routeByCode.set(cleanRunName(r.code).toUpperCase(), r);
  }

  const warnings = [...parsed.warnings];
  const rows = [];
  for (const row of parsed.rows) {
    if (row.actualHours === 0 && row.totalTrips === 0 && row.otpPct === 0) {
      warnings.push(`${row.date}: route "${row.route}" had no hours, trips, or OTP - treated as closed for the day and skipped.`);
      continue;
    }

    const routeCode = row.route.trim().toUpperCase();
    const route = routeByCode.get(routeCode);
    if (!route) {
      warnings.push(`${row.date}: no route "${row.route}" found in this division - skipped.`);
      continue;
    }
    rows.push({
      route: route.code,
      date: row.date,
      actualHours: Math.round(row.actualHours * 100) / 100,
      totalTrips: Math.round(row.totalTrips),
      otpPct: Math.round(row.otpPct * 1000) / 10, // store as 0-100 for the editable preview, same convention as the template
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.route.localeCompare(b.route)));

  res.json({ rows, warnings });
};

// Bulk-upserts reviewed preprocessed rows the same way importKpiEntries
// does for a filled-in template.
export const confirmKpiEntries = async (req, res) => {
  const { division, rows } = req.body;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "No rows to import." });
  }

  const routes = await Route.find({ division });
  const routeByCode = new Map();
  for (const r of routes) {
    routeByCode.set(r.code.trim().toUpperCase(), r);
    routeByCode.set(cleanRunName(r.code).toUpperCase(), r);
  }

  const errors = [];
  const parsed = [];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const routeCode = String(row.route ?? "").trim().toUpperCase();
    const route = routeByCode.get(routeCode) || routeByCode.get(cleanRunName(routeCode).toUpperCase());
    const date = parseUploadDate(row.date);
    const actualHours = typeof row.actualHours === "number" ? row.actualHours : parseFloat(row.actualHours);
    const totalTrips = typeof row.totalTrips === "number" ? row.totalTrips : parseFloat(row.totalTrips);
    const otpPct = normalizePercent(row.otpPct);

    if (!routeCode) errors.push(`Row ${rowNum}: Route is required`);
    else if (!route) errors.push(`Row ${rowNum}: unknown route "${row.route}" for this division`);
    if (!date) errors.push(`Row ${rowNum}: invalid or missing Date`);
    if (!Number.isFinite(actualHours) || actualHours < 0)
      errors.push(`Row ${rowNum}: Actual Service Hours must be a number ≥ 0`);
    if (!Number.isFinite(totalTrips) || totalTrips < 0)
      errors.push(`Row ${rowNum}: Total Trips must be a number ≥ 0`);
    if (otpPct === null || otpPct < 0 || otpPct > 1)
      errors.push(`Row ${rowNum}: OTP % must be between 0 and 100 (or 0 and 1)`);

    if (date && route && Number.isFinite(actualHours) && Number.isFinite(totalTrips) && otpPct !== null) {
      parsed.push({ date, route: route._id, actualHours, totalTrips, otpPct });
    }
  });

  if (errors.length) {
    return res.status(400).json({
      message: "Some rows have errors and nothing was imported.",
      errors: errors.slice(0, 20),
      extraErrorCount: Math.max(0, errors.length - 20),
    });
  }

  let created = 0;
  let updated = 0;
  for (const row of parsed) {
    const result = await DailyKpiEntry.findOneAndUpdate(
      { division, route: row.route, date: row.date },
      { ...row, division, updatedBy: req.user._id },
      { upsert: true, new: true, rawResult: true, setDefaultsOnInsert: true }
    );
    if (result.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  res.json({ audit: { validRows: parsed.length, created, updated } });
};
