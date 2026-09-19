import DivisionThresholdChange from "../models/DivisionThresholdChange.js";

export const loadThresholdHistory = (divisionId) =>
  DivisionThresholdChange.find({ division: divisionId }).sort({ effectiveDate: -1 }).lean();

// history must already be sorted newest-first (loadThresholdHistory does
// this). Picks the latest entry effective on or before `date`. A future
// entry never applies to an earlier date, and a date older than every
// recorded entry uses `fallback` (the division's own pre-history value)
// instead of guessing from whatever entry happens to exist.
export const resolveThresholdsFromHistory = (history, date, fallback) => {
  const entry = history.find((item) => item.effectiveDate <= date);
  return entry ? { breakMinutes: entry.breakMinutes, revenueRatio: entry.revenueRatio } : fallback;
};

export const getEffectiveThresholds = async (division, date) => {
  const history = await loadThresholdHistory(division._id);
  return resolveThresholdsFromHistory(history, date, {
    breakMinutes: division.thresholds.breakMinutes,
    revenueRatio: division.thresholds.revenueRatio,
  });
};
