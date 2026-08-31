import { buildTrackerRows } from "./trackerRows.js";
import { routeDailyData, computeRankings, networkSummary } from "./rankings.js";
import { addDays } from "../weeklyMetrics.js";

const toISODate = (date) => new Date(date).toISOString().slice(0, 10);

const monthFloor = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

const addMonths = (date, n) => {
  const d = monthFloor(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
};

const monthEnd = (date) => {
  const start = monthFloor(date);
  const next = addMonths(start, 1);
  return addDays(next, -1);
};

// One week/month "slice": raw daily rows, rankings, and the network summary.
const computeWindow = async (division, kpiSettings, from, to, weekStart) => {
  const rows = await buildTrackerRows(division._id, from, to);
  const daily = routeDailyData(rows);
  const rankings = computeRankings(daily, kpiSettings);
  return {
    weekStart: weekStart ? toISODate(weekStart) : undefined,
    from: toISODate(from),
    to: toISODate(to),
    rankings,
    summary: networkSummary(daily, rankings),
  };
};

export const weeklySeries = async (division, kpiSettings, latestWeekStart, weeks = 6) => {
  const windows = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekStart = addDays(latestWeekStart, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    windows.push(await computeWindow(division, kpiSettings, weekStart, weekEnd, weekStart));
  }
  return windows;
};

export const monthlySeries = async (division, kpiSettings, latestMonthStart, months = 6) => {
  const windows = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = addMonths(latestMonthStart, -i);
    const end = monthEnd(start);
    windows.push({ ...(await computeWindow(division, kpiSettings, start, end)), monthStart: toISODate(start) });
  }
  return windows;
};

export { monthFloor };
