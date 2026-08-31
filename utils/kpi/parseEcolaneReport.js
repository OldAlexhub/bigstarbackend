import { normalizePercent } from "./excelDates.js";
import {
  sheetToGrid,
  findReportCell,
  extractReportDateRange,
  cleanRunName,
  parseReportDate,
  numericValue,
  cellText,
} from "./reportParsing.js";

// Ports cleaning.R's clean_daily_run_productivity, with hardening the R
// script doesn't have: a real multi-page export can repeat its two-row
// header once per printed page, and a later page's "Revenue" column (and,
// observed on a real export, even the "Run" name column itself — some
// exports carry a blank leading column A that shifts everything one column
// right) can land in a different position than the first page's.
// cleaning.R locates these once for the whole file, which silently
// misreads later pages, or the whole file, when that happens; this
// re-locates them at every repeated header instead, so each page/file is
// read using its own actual columns.
const cleanDailyRunProductivity = (buffer) => {
  const grid = sheetToGrid(buffer);

  // Every occurrence of an exact "Comp" cell marks the start of a new
  // page's data rows; "Revenue" and "Run" for that page sit somewhere in
  // the one or two rows above it (the merged group-header row).
  const sections = [];
  grid.forEach((line, r) => {
    (line || []).forEach((value, c) => {
      if (!/^\s*Comp\s*$/i.test(cellText(value))) return;
      let revenueCol = null;
      let runCol = null;
      for (let scanRow = r; scanRow >= Math.max(0, r - 2); scanRow -= 1) {
        const scanLine = grid[scanRow] || [];
        if (revenueCol === null) {
          const found = scanLine.findIndex((v) => /^\s*Revenue\s*$/i.test(cellText(v)));
          if (found !== -1) revenueCol = found;
        }
        if (runCol === null) {
          const found = scanLine.findIndex((v) => /^\s*Run\s*$/i.test(cellText(v)));
          if (found !== -1) runCol = found;
        }
      }
      if (revenueCol !== null && runCol !== null) sections.push({ headerRow: r, completedCol: c, revenueCol, runCol });
    });
  });
  if (sections.length === 0) {
    throw new Error("Could not find the run name / completed trips / revenue time columns.");
  }

  const sectionFor = (r) => {
    let current = sections[0];
    for (const section of sections) {
      if (section.headerRow > r) break;
      current = section;
    }
    return current;
  };

  const rows = [];
  let lastDate = null;
  let rowIndex = 0;

  for (let r = 0; r < grid.length; r += 1) {
    const line = grid[r] || [];
    const { completedCol, revenueCol, runCol } = sectionFor(r);
    const rawRunName = line[runCol];
    const parsedDate = parseReportDate(rawRunName);
    if (parsedDate) lastDate = parsedDate;

    const nameText = cellText(rawRunName);
    if (
      rawRunName === null ||
      rawRunName === undefined ||
      !nameText.includes(",") ||
      line[runCol + 1] === null ||
      line[runCol + 1] === undefined ||
      /Summary|Daily Run|Date range/i.test(nameText)
    ) {
      continue;
    }

    const commaIndex = nameText.indexOf(",");
    rows.push({
      daily_row: rowIndex,
      date: lastDate,
      run: cleanRunName(nameText.slice(0, commaIndex)),
      name: nameText.slice(commaIndex + 1).trim().replace(/\s+/g, " "),
      trip_completed: numericValue(line[completedCol]),
      revenue_time: numericValue(line[revenueCol]),
    });
    rowIndex += 1;
  }

  return rows;
};

// Ports cleaning.R's clean_driver_performance: the date range comes from
// report-level header text (not a per-row column), "Rides per Hour Est/Act"
// is a single header cell whose ACTUAL value lives two columns to the
// right (the "Est / Act" label sits in between), and OTP comes from the
// "OTP (Trips)" column.
const cleanDriverPerformance = (buffer) => {
  const grid = sheetToGrid(buffer);
  const { dateStart, dateEnd } = extractReportDateRange(grid);

  const driverCell = findReportCell(grid, /^\s*Driver\s*$/i, "driver");
  const ridesCell = findReportCell(grid, /^\s*Rides per Hour\s*Est\s*\/\s*Act\s*$/i, "rides per hour");
  const otpCell = findReportCell(grid, /^\s*OTP \(Trips\)\s*$/i, "OTP (Trips)");
  const tpshCol = ridesCell.col + 2;

  const byName = new Map();
  for (let r = driverCell.row + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    const rawName = line[driverCell.col];
    const nameText = cellText(rawName).trim();
    if (!nameText || nameText === "Driver" || nameText === "Summary:") continue;

    const tpsh = numericValue(line[tpshCol]);
    const otpTrips = normalizePercent(line[otpCell.col]);
    if (tpsh === null || otpTrips === null) continue;

    if (!byName.has(nameText)) {
      byName.set(nameText, { name: nameText, tpsh, otpTrips, dateStart, dateEnd });
    }
  }

  return byName;
};

// Ports cleaning.R's build_run_driver_output: joins productivity rows to
// performance rows by driver name within the performance report's date
// range, then applies the per-date completeness gate - a date is kept only
// if every productivity row for that date is itself fully parsed AND found
// a matching, in-range performance row. A single bad row drops the whole
// date rather than importing partial numbers for it.
export const parseEcolaneReport = (dailyBuffer, performanceBuffer) => {
  const dailyRows = cleanDailyRunProductivity(dailyBuffer);
  const performanceByName = cleanDriverPerformance(performanceBuffer);

  const byDate = new Map();
  for (const row of dailyRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const rows = [];
  const warnings = [];

  for (const [date, dateRows] of byDate) {
    if (!date) {
      warnings.push(`${dateRows.length} row(s) had no date found above them in the file - skipped.`);
      continue;
    }

    const complete = dateRows.every(
      (row) => row.run && row.name && row.trip_completed !== null && row.revenue_time !== null
    );
    if (!complete) {
      warnings.push(`${date}: at least one run row in the Daily Run Productivity file was unreadable - the whole date was skipped.`);
      continue;
    }

    const matched = dateRows.map((row) => {
      const perf = performanceByName.get(row.name);
      if (!perf) return null;
      if (date < perf.dateStart || date > perf.dateEnd) return null;
      return { ...row, otpPct: perf.otpTrips };
    });

    if (matched.some((m) => m === null)) {
      const unmatchedNames = dateRows
        .filter((_, i) => matched[i] === null)
        .map((r) => r.name)
        .join(", ");
      warnings.push(
        `${date}: not every run matched a driver in Driver Performance (missing: ${unmatchedNames}) - the whole date was skipped.`
      );
      continue;
    }

    for (const m of matched) {
      rows.push({ date, route: m.run, actualHours: m.revenue_time, totalTrips: m.trip_completed, otpPct: m.otpPct });
    }
  }

  return { rows, warnings };
};
