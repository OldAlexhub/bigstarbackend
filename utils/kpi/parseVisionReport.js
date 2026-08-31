import { normalizePercent } from "./excelDates.js";
import { sheetToGrid, findReportCell, findHeaderColumn, cleanRunName, parseReportDate, numericValue, cellText } from "./reportParsing.js";

// Ports cleaning.R's clean_vision_para_operations: a single Vision "Report
// Para Operations" export already has one row per date+route with every
// KPI field needed, but the header is a messy two-row merged layout (e.g.
// two columns literally named "Service" - one under a Miles group, one
// under an Hours group), so columns are located by header text rather than
// fixed position.
export const parseVisionReport = (buffer) => {
  const grid = sheetToGrid(buffer);

  const dateHeaderCell = findReportCell(grid, /^\s*Date\s*$/i, "Vision date");
  const headerRow = dateHeaderCell.row;
  const dateCol = dateHeaderCell.col;

  const routeCol = findHeaderColumn(
    grid,
    headerRow,
    [/^\s*Run\s*\/\s*Route\s*$/i, /^\s*Route\s*$/i, /^\s*Rt\s*$/i],
    "Vision route",
    3
  );
  const totalProvidedCol = findHeaderColumn(
    grid,
    headerRow,
    [/^\s*Total\s+Prov(?:ided)?\s*$/i, /^\s*Provided\s*$/i],
    "Vision total provided",
    6
  );
  const otpCol = findHeaderColumn(
    grid,
    headerRow,
    [/^\s*OTP\s*%\s*$/i, /^\s*OTP\s*$/i],
    "Vision OTP percent",
    30
  );
  const serviceHoursCol = findHeaderColumn(
    grid,
    headerRow,
    [/^\s*Service\s+Hours?\s*$/i, /^\s*Svc\.?\s*Hours?\s*$/i, /^\s*Service\s*$/i],
    "Vision service hours",
    41,
    true
  );

  const rows = [];
  const warnings = [];
  let lastDate = null;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    const rawRoute = cleanRunName(line[routeCol]);
    const rawDate = parseReportDate(line[dateCol]);
    if (rawDate) lastDate = rawDate;
    const date = rawDate || lastDate;

    if (!date || !rawRoute) continue;
    if (/^(Run\s*\/\s*Route|Sub\s*Total|Grand\s*Total)$/.test(rawRoute)) continue;

    const totalTrips = numericValue(line[totalProvidedCol]);
    const otpPct = normalizePercent(line[otpCol]);
    const actualHours = numericValue(line[serviceHoursCol]);

    if (totalTrips === null || otpPct === null || actualHours === null) {
      warnings.push(
        `Row ${r + 1}: route "${cellText(line[routeCol])}" on ${date} has an unreadable Total Provided, OTP %, or Service Hours value - skipped.`
      );
      continue;
    }

    rows.push({ date, route: rawRoute, actualHours, totalTrips, otpPct });
  }

  return { rows, warnings };
};
