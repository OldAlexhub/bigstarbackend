import XLSX from "xlsx";
import { excelSerialToISODate } from "./excelDates.js";

// Shared helpers for porting the DIV_7 "cleaning.R" raw-export cleaners
// (Vision / Ecolane) into JS. These mirror cleaning.R's find_report_cell /
// find_header_column / parse_report_date / extract_report_date_range
// exactly, including their quirks, so the ported parsers stay faithful to
// the R script rather than reinventing the column-finding logic.

export const sheetToGrid = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
};

const cellText = (value) => (value === null || value === undefined ? "" : String(value));

// Scans the entire grid for the first cell whose text exactly matches
// `pattern`. Mirrors cleaning.R's find_report_cell (uses find_report_cells
// under the hood, which scans every row/col of the raw sheet).
export const findReportCell = (grid, pattern, description) => {
  for (let row = 0; row < grid.length; row += 1) {
    const cols = grid[row] || [];
    for (let col = 0; col < cols.length; col += 1) {
      if (pattern.test(cellText(cols[col]))) return { row, col };
    }
  }
  throw new Error(`Could not find the ${description} column.`);
};

// Scans one header row for the first pattern (in priority order) that
// matches any cell, picking the first or last match per `preferLast`.
// Falls back to a fixed column index, then throws. Mirrors cleaning.R's
// find_header_column.
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
// "BST-Standby/4501" -> "Standby/4501", "BST1101" -> "1101". Mirrors
// cleaning.R's clean_run_name.
export const cleanRunName = (value) =>
  cellText(value)
    .replace(/^\s*BST(?:\s*-\s*|\s*)/i, "")
    .trim();

// Parses a "MM/DD/YYYY" text date embedded anywhere in the value, falling
// back to Excel-serial conversion. Mirrors cleaning.R's parse_report_date
// (which relies on excel_serial_to_date's 20000-100000 sanity range).
export const parseReportDate = (value) => {
  const text = cellText(value);
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, mm, dd, yyyy] = match;
    const month = String(mm).padStart(2, "0");
    const day = String(dd).padStart(2, "0");
    return `${yyyy}-${month}-${day}`;
  }
  const serial = typeof value === "number" ? value : parseFloat(text);
  if (Number.isFinite(serial) && serial >= 20000 && serial <= 100000) {
    return excelSerialToISODate(serial);
  }
  return null;
};

// Extracts "Date range: MM/DD/YYYY - MM/DD/YYYY" from anywhere in the
// grid's concatenated text. Mirrors cleaning.R's extract_report_date_range.
export const extractReportDateRange = (grid) => {
  const text = grid.map((row) => (row || []).map(cellText).join(" ")).join(" ");
  const match = text.match(/Date range:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!match) throw new Error("Could not find the Driver Performance date range.");
  const toISO = (mdY) => {
    const [mm, dd, yyyy] = mdY.split("/");
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  };
  return { dateStart: toISO(match[1]), dateEnd: toISO(match[2]) };
};

export const numericValue = (value) => {
  if (typeof value === "number") return value;
  const num = parseFloat(cellText(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
};

export { cellText };
