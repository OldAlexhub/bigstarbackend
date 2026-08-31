const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export const excelSerialToISODate = (serial) => {
  const ms = EXCEL_EPOCH_MS + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
};

export const parseUploadDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return excelSerialToISODate(value);

  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
};

export const normalizePercent = (value) => {
  const num = typeof value === "number" ? value : parseFloat(String(value).replace("%", ""));
  if (!Number.isFinite(num)) return null;
  return num > 1 ? num / 100 : num;
};
