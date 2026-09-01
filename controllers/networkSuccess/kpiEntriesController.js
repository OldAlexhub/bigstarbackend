import DailyKpiEntry from "../../models/DailyKpiEntry.js";
import Route from "../../models/Route.js";
import Provider from "../../models/Provider.js";
import Operator from "../../models/Operator.js";
import { canAccessDivision } from "../../middleware/access.js";
import { parseUploadDate, normalizePercent } from "../../utils/kpi/excelDates.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { parseDailyKpiTrackerReport } from "../../utils/kpi/parseDailyKpiTracker.js";
import { cleanRunName } from "../../utils/kpi/reportParsing.js";
import { buildLeadingNumberIndex, resolveRouteCode } from "../../utils/kpi/routeMatching.js";
import { aggregateUploadRows } from "../../utils/kpi/aggregateUploadRows.js";

const buildRouteByCode = (routes) => {
  const routeByCode = new Map();
  for (const r of routes) {
    routeByCode.set(r.code.trim().toUpperCase(), r);
    routeByCode.set(cleanRunName(r.code).toUpperCase(), r);
  }
  return routeByCode;
};

const buildProviderByName = (providers) => {
  const providerByName = new Map();
  for (const p of providers) providerByName.set(p.name.trim().toLowerCase(), p);
  return providerByName;
};

// Providers aren't auto-created the way Operator/Vehicle/Route are
// (Provider is a curated list, managed explicitly) - a match against the
// real collection gets the canonical name; anything unrecognized is still
// kept as-is rather than dropped, since it's just a fallback display label,
// not a required key like Route.
const resolveProviderName = (rawName, providerByName) => {
  if (!rawName) return { name: null, matched: false };
  const match = providerByName.get(rawName.trim().toLowerCase());
  return match ? { name: match.name, matched: true } : { name: rawName, matched: false };
};

const buildOperatorByName = (operators) => {
  const operatorByName = new Map();
  for (const o of operators) operatorByName.set(o.name.trim().toLowerCase(), o);
  return operatorByName;
};

// Operators ARE company-wide (Operator.js has no division ref, confirmed in
// resolveAssignment.js), so a single collection-wide lookup applies
// regardless of which division is being imported. Same "match if possible,
// keep as typed otherwise" behavior as resolveProviderName.
const resolveOperatorName = (rawName, operatorByName) => {
  if (!rawName) return { name: null, matched: false };
  const match = operatorByName.get(rawName.trim().toLowerCase());
  return match ? { name: match.name, matched: true } : { name: rawName, matched: false };
};

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

// Parses an uploaded Daily KPI Tracker workbook into {date, route,
// actualHours, totalTrips, otpPct, routeClosures, lateToFirst, lateDeploy}
// rows, resolves each row's route code against this division (exact match,
// falling back to a same-leading-number match for suffix variants that
// don't have their own Master Run Cuts route), combines any rows that
// resolve to the same route/date, and returns a preview - nothing is saved
// until confirmKpiEntries is called with the (possibly hand-edited) rows.
export const preprocessRawReport = async (req, res) => {
  const { division } = req.body;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const file1 = req.files?.file1?.[0];
  if (!file1) {
    return res.status(400).json({ message: "Upload the Daily KPI Tracker file." });
  }

  let parsed;
  try {
    parsed = parseDailyKpiTrackerReport(file1.buffer);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Could not read the uploaded file." });
  }

  // Master Run Cuts route codes in this app keep their "BST" prefix
  // (e.g. "BST1101", "BST-Standby/4501"), but the tracker's Route column
  // doesn't, since that's what distinguishes the route from the rest of the
  // cell text. Index routes by both their exact code and BST-stripped code
  // so either form matches; leadingNumberIndex backs the fallback for
  // suffix variants (e.g. "1101-B") that have no route of their own.
  const routes = await Route.find({ division });
  const routeByCode = buildRouteByCode(routes);
  const leadingNumberIndex = buildLeadingNumberIndex(routes);
  const providerByName = buildProviderByName(await Provider.find());
  const operatorByName = buildOperatorByName(await Operator.find());

  const warnings = [...parsed.warnings];
  const unmatchedProviders = new Set();
  const unmatchedOperators = new Set();
  const resolvedRows = [];
  for (const row of parsed.rows) {
    const result = resolveRouteCode(row.route, routeByCode, leadingNumberIndex);
    if (result.ambiguous) {
      const candidateCodes = result.candidates.map((c) => c.code).join(", ");
      warnings.push(`${row.date}: route "${row.route}" matches more than one route by leading number (${candidateCodes}) - skipped, resolve manually.`);
      continue;
    }
    if (!result.route) {
      warnings.push(`${row.date}: no route "${row.route}" found in this division - skipped.`);
      continue;
    }
    if (result.fuzzy) {
      warnings.push(`${row.date}: route "${row.route}" matched to existing route "${result.route.code}" by leading route number.`);
    }
    const providerResult = resolveProviderName(row.provider, providerByName);
    if (row.provider && !providerResult.matched) unmatchedProviders.add(row.provider);
    const operatorResult = resolveOperatorName(row.operator, operatorByName);
    if (row.operator && !operatorResult.matched) unmatchedOperators.add(row.operator);
    resolvedRows.push({
      ...row,
      routeId: result.route._id.toString(),
      routeCode: result.route.code,
      sourceRoute: row.route,
      provider: providerResult.name,
      operator: operatorResult.name,
    });
  }

  if (unmatchedProviders.size) {
    warnings.push(
      `${unmatchedProviders.size} provider name(s) in the file don't match anything in Providers (kept as typed): ${[...unmatchedProviders].join(", ")}.`
    );
  }
  if (unmatchedOperators.size) {
    warnings.push(
      `${unmatchedOperators.size} operator name(s) in the file don't match anything in Master Run Cuts (kept as typed): ${[...unmatchedOperators].join(", ")}.`
    );
  }

  const { rows: aggregated, mergeNotes } = aggregateUploadRows(resolvedRows);

  const rows = aggregated.map((row) => ({
    route: row.routeCode,
    date: row.date,
    actualHours: Math.round(row.actualHours * 100) / 100,
    totalTrips: Math.round(row.totalTrips),
    otpPct: Math.round(row.otpPct * 1000) / 10, // store as 0-100 for the editable preview, same convention as the template
    routeClosures: row.routeClosures,
    lateToFirst: row.lateToFirst,
    lateDeploy: row.lateDeploy,
    schedHours: row.schedHours,
    provider: row.provider,
    operator: row.operator,
    mergedFrom: row.mergedFrom,
  }));

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.route.localeCompare(b.route)));

  res.json({ rows, warnings, mergeNotes });
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
  const routeByCode = buildRouteByCode(routes);
  const leadingNumberIndex = buildLeadingNumberIndex(routes);
  const providerByName = buildProviderByName(await Provider.find());
  const operatorByName = buildOperatorByName(await Operator.find());

  // Optional integer field (Route Closures / Late to First / Late Deploy) -
  // blank/missing means "no value given" (null), not 0.
  const parseOptionalCount = (value) => {
    if (value === undefined || value === null || value === "") return { value: null, valid: true };
    const num = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(num) && num >= 0 ? { value: Math.round(num), valid: true } : { value: null, valid: false };
  };

  // Same as above but for Scheduled Hours - a decimal, not a count, so it
  // isn't rounded to an integer.
  const parseOptionalDecimal = (value) => {
    if (value === undefined || value === null || value === "") return { value: null, valid: true };
    const num = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(num) && num >= 0 ? { value: num, valid: true } : { value: null, valid: false };
  };

  const errors = [];
  const resolvedRows = [];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const routeText = String(row.route ?? "").trim();
    const routeResult = routeText ? resolveRouteCode(routeText, routeByCode, leadingNumberIndex) : { route: null };
    const date = parseUploadDate(row.date);
    const actualHours = typeof row.actualHours === "number" ? row.actualHours : parseFloat(row.actualHours);
    const totalTrips = typeof row.totalTrips === "number" ? row.totalTrips : parseFloat(row.totalTrips);
    const otpPct = normalizePercent(row.otpPct);
    const routeClosures = parseOptionalCount(row.routeClosures);
    const lateToFirst = parseOptionalCount(row.lateToFirst);
    const lateDeploy = parseOptionalCount(row.lateDeploy);
    const schedHours = parseOptionalDecimal(row.schedHours);
    const providerText = row.provider != null ? String(row.provider).trim() || null : null;
    const providerResult = resolveProviderName(providerText, providerByName);
    const operatorText = row.operator != null ? String(row.operator).trim() || null : null;
    const operatorResult = resolveOperatorName(operatorText, operatorByName);

    if (!routeText) errors.push(`Row ${rowNum}: Route is required`);
    else if (routeResult.ambiguous) {
      const candidateCodes = routeResult.candidates.map((c) => c.code).join(", ");
      errors.push(`Row ${rowNum}: route "${row.route}" matches more than one route by leading number (${candidateCodes})`);
    } else if (!routeResult.route) errors.push(`Row ${rowNum}: unknown route "${row.route}" for this division`);
    if (!date) errors.push(`Row ${rowNum}: invalid or missing Date`);
    if (!Number.isFinite(actualHours) || actualHours < 0)
      errors.push(`Row ${rowNum}: Actual Service Hours must be a number ≥ 0`);
    if (!Number.isFinite(totalTrips) || totalTrips < 0)
      errors.push(`Row ${rowNum}: Total Trips must be a number ≥ 0`);
    if (otpPct === null || otpPct < 0 || otpPct > 1)
      errors.push(`Row ${rowNum}: OTP % must be between 0 and 100 (or 0 and 1)`);
    if (!routeClosures.valid) errors.push(`Row ${rowNum}: Route Closures must be a number ≥ 0`);
    if (!lateToFirst.valid) errors.push(`Row ${rowNum}: Late to First must be a number ≥ 0`);
    if (!lateDeploy.valid) errors.push(`Row ${rowNum}: Late Deploy must be a number ≥ 0`);
    if (!schedHours.valid) errors.push(`Row ${rowNum}: Scheduled Hours must be a number ≥ 0`);

    if (
      date &&
      routeResult.route &&
      Number.isFinite(actualHours) &&
      Number.isFinite(totalTrips) &&
      otpPct !== null &&
      routeClosures.valid &&
      lateToFirst.valid &&
      lateDeploy.valid &&
      schedHours.valid
    ) {
      resolvedRows.push({
        date,
        routeId: routeResult.route._id.toString(),
        routeCode: routeResult.route.code,
        sourceRoute: routeText,
        actualHours,
        totalTrips,
        otpPct,
        // A blank cell means 0, same convention as the parser - null is
        // reserved for entries this whole import flow never touched at all.
        routeClosures: routeClosures.value ?? 0,
        lateToFirst: lateToFirst.value ?? 0,
        lateDeploy: lateDeploy.value ?? 0,
        // Scheduled Hours/Provider/Operator are fallback-only values - a
        // blank cell here genuinely means "not given" (null), not zero.
        schedHours: schedHours.value,
        provider: providerResult.name,
        operator: operatorResult.name,
      });
    }
  });

  if (errors.length) {
    return res.status(400).json({
      message: "Some rows have errors and nothing was imported.",
      errors: errors.slice(0, 20),
      extraErrorCount: Math.max(0, errors.length - 20),
    });
  }

  // Guards against two hand-edited preview rows sharing the same route/date
  // (DailyKpiEntry's unique index allows only one entry per route/day) -
  // without this, the second upsert below would silently overwrite the
  // first instead of combining them.
  const { rows: parsed } = aggregateUploadRows(resolvedRows);

  let created = 0;
  let updated = 0;
  for (const row of parsed) {
    const result = await DailyKpiEntry.findOneAndUpdate(
      { division, route: row.routeId, date: row.date },
      {
        division,
        route: row.routeId,
        date: row.date,
        actualHours: row.actualHours,
        totalTrips: row.totalTrips,
        otpPct: row.otpPct,
        uploadRouteClosures: row.routeClosures,
        uploadLateToFirst: row.lateToFirst,
        uploadLateDeploy: row.lateDeploy,
        uploadSchedHours: row.schedHours,
        uploadProvider: row.provider,
        uploadOperator: row.operator,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, rawResult: true, setDefaultsOnInsert: true }
    );
    if (result.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  res.json({ audit: { validRows: parsed.length, created, updated } });
};
