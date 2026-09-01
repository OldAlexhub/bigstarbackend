import XLSX from "xlsx";

// Shared helpers for the Daily KPI Tracker parser and route-code matching.

// Targets a workbook sheet by name (case/whitespace insensitive) - needed
// for workbooks like the Daily KPI Tracker template that carry several
// sheets (Settings, Daily Tracker, Weekly Provider Avg, ...) and only one
// of them is the real data.
export const findSheetByName = (buffer, name) => {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const target = name.trim().toLowerCase();
  const sheetName = workbook.SheetNames.find((n) => n.trim().toLowerCase() === target);
  if (!sheetName) throw new Error(`Could not find a "${name}" sheet in this workbook.`);
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
};

const cellText = (value) => (value === null || value === undefined ? "" : String(value));

// Scans one header row for the first pattern (in priority order) that
// matches any cell, picking the first or last match per `preferLast`.
// Falls back to a fixed column index, then throws.
export const findHeaderColumn = (grid, headerRow, patterns, description, fallbackColumn, preferLast = false) => {
  const headerValues = grid[headerRow] || [];
  for (const pattern of patterns) {
    const matches = [];
    headerValues.forEach((value, col) => {
      if (pattern.test(cellText(value))) matches.push(col);
    });
    if (matches.length > 0) return preferLast ? matches[matches.length - 1] : matches[0];
  }
  if (fallbackColumn !== undefined && fallbackColumn < headerValues.length) return fallbackColumn;
  throw new Error(`Could not find the ${description} column.`);
};

// Strips a leading "BST" prefix (with optional "-" separator), e.g.
// "BST-Standby/4501" -> "Standby/4501", "BST1101" -> "1101". Also collapses
// all internal whitespace, since real uploads spell the same route
// inconsistently (e.g. "4001- WE" in a tracker file vs. "BST4001-WE" as the
// actual Route code) - without this, an exact match on a real suffixed
// route can fail on whitespace alone and wrongly fall through to
// leading-number fuzzy matching instead.
export const cleanRunName = (value) =>
  cellText(value)
    .replace(/^\s*BST(?:\s*-\s*|\s*)/i, "")
    .trim()
    .replace(/\s+/g, "");

export const numericValue = (value) => {
  if (typeof value === "number") return value;
  const num = parseFloat(cellText(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
};

export { cellText };
