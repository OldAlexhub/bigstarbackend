import { normalizePercent, excelSerialToISODate } from "./excelDates.js";
import { findSheetByName, findHeaderColumn, numericValue, cellText } from "./reportParsing.js";

// Parses the "Daily Tracker" sheet of the "Daily KPI Tracker - Provider
// Management V2" workbook - a flat, single-header-row Excel Table, much
// simpler than the old Vision/Ecolane multi-page/merged-header exports it
// replaces. Columns are located by header text, not fixed position, so this
// tolerates both the older (plain literal values, 13 columns) and newer
// (VLOOKUP-formula-driven Operator/Provider/Scheduled Hours, extra "Shift"
// column, extra derived sheets) versions of the template equally - neither
// of those differences matters here since only 7 columns are ever read.
//
// Deliberately NOT read: Operator, Provider, Scheduled Service Hours,
// Fulfillment %, Trips Per Service Hour, Shift. Operator/Provider/Scheduled
// Hours already come from Master Run Cuts ("derive, don't re-enter" - see
// trackerRows.js); Fulfillment %/TPSH are recomputed live elsewhere. Fulfillment
// % is also never safe to divide by 100 the way OTP % is - it's stored as a
// true fraction that routinely exceeds 1 (actual hours can exceed scheduled),
// unlike OTP % which is a plain 0-100 number - so skipping it entirely avoids
// that trap rather than needing a column-aware exception.
export const parseDailyKpiTrackerReport = (buffer) => {
  const grid = findSheetByName(buffer, "Daily Tracker");
  if (grid.length < 2) {
    throw new Error('The "Daily Tracker" sheet has no data rows.');
  }

  const headerRow = 0;
  const dateCol = findHeaderColumn(grid, headerRow, [/^\s*Date\s*$/i], "Daily Tracker date", 0);
  const routeCol = findHeaderColumn(grid, headerRow, [/^\s*Route\s*$/i], "Daily Tracker route", 3);
  const actualHoursCol = findHeaderColumn(
    grid,
    headerRow,
    [/^\s*Actual\s+Service\s+Hours\s*$/i],
    "Actual Service Hours",
    5
  );
  const totalTripsCol = findHeaderColumn(grid, headerRow, [/^\s*Total\s+Trips\s*$/i], "Total Trips", 7);
  const otpCol = findHeaderColumn(grid, headerRow, [/^\s*OTP\s*%\s*$/i], "OTP %", 9);
  // "Route Clousers" is a real header typo in the source template (means
  // "Route Closures") - matched literally, since that's the actual text
  // every real export contains, not something to "correct."
  const routeClosuresCol = findHeaderColumn(grid, headerRow, [/^\s*Route\s+Clousers\s*$/i], "Route Clousers", 10);
  const lateToFirstCol = findHeaderColumn(grid, headerRow, [/^\s*Late\s+to\s+First\s*$/i], "Late to First", 11);
  const lateDeployCol = findHeaderColumn(grid, headerRow, [/^\s*Late\s+Deploy\s*$/i], "Late Deploy", 12);

  const rows = [];
  const warnings = [];

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    if (line.every((v) => v === null || v === "")) continue; // trailing blank table rows

    const rawDateCell = line[dateCol];
    const date = typeof rawDateCell === "number" ? excelSerialToISODate(rawDateCell) : null;
    const rawRoute = cellText(line[routeCol]).trim();

    if (!date || !rawRoute) {
      warnings.push(`Row ${r + 1}: missing Date or Route - skipped.`);
      continue;
    }

    const actualHours = numericValue(line[actualHoursCol]);
    const totalTrips = numericValue(line[totalTripsCol]);
    const otpPct = normalizePercent(line[otpCol]);

    if (actualHours === null || totalTrips === null || otpPct === null) {
      warnings.push(
        `Row ${r + 1}: route "${rawRoute}" on ${date} has an unreadable Actual Service Hours, Total Trips, or OTP % value - skipped.`
      );
      continue;
    }

    // Route Clousers / Late to First / Late Deploy cells are frequently
    // truly blank in real exports - blank means 0, not "unreadable."
    const routeClosures = numericValue(line[routeClosuresCol]) ?? 0;
    const lateToFirst = numericValue(line[lateToFirstCol]) ?? 0;
    const lateDeploy = numericValue(line[lateDeployCol]) ?? 0;

    if (actualHours === 0 && totalTrips === 0 && otpPct === 0 && routeClosures === 0 && lateToFirst === 0 && lateDeploy === 0) {
      warnings.push(`${date}: route "${rawRoute}" had no hours, trips, OTP, or events - treated as closed for the day and skipped.`);
      continue;
    }

    rows.push({ date, route: rawRoute, actualHours, totalTrips, otpPct, routeClosures, lateToFirst, lateDeploy });
  }

  return { rows, warnings };
};
