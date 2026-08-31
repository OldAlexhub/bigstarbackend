import { canAccessDivision } from "../../middleware/access.js";
import { startOfWeek, addDays } from "../../utils/weeklyMetrics.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { DAYS_OF_WEEK } from "../../utils/hours.js";

export const getOperationalAnalysis = async (req, res) => {
  const { division, weekStart: weekStartParam } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const rows = await buildTrackerRows(division, weekStart, weekEnd);

  const byDay = {};
  DAYS_OF_WEEK.forEach((label, i) => {
    const date = addDays(weekStart, i).toISOString().slice(0, 10);
    const dayRows = rows.filter((r) => r.date === date);
    byDay[label] = {
      date,
      trips: dayRows.reduce((s, r) => s + r.totalTrips, 0),
      actualHrs: Math.round(dayRows.reduce((s, r) => s + r.actualHrs, 0) * 100) / 100,
    };
  });

  const byRoute = new Map();
  for (const row of rows) {
    if (!byRoute.has(row.route)) byRoute.set(row.route, { route: row.route, trips: 0, actualHrs: 0 });
    const bucket = byRoute.get(row.route);
    bucket.trips += row.totalTrips;
    bucket.actualHrs += row.actualHrs;
  }
  const tripsByRoute = Array.from(byRoute.values())
    .map((r) => ({ ...r, actualHrs: Math.round(r.actualHrs * 100) / 100 }))
    .sort((a, b) => b.trips - a.trips);

  const weekdayRows = rows.filter((r) => !["SUN", "SAT"].includes(DAYS_OF_WEEK[new Date(r.date).getUTCDay()]));
  const weekendRows = rows.filter((r) => ["SUN", "SAT"].includes(DAYS_OF_WEEK[new Date(r.date).getUTCDay()]));

  const summarizeBlock = (blockRows) => ({
    trips: blockRows.reduce((s, r) => s + r.totalTrips, 0),
    actualHrs: Math.round(blockRows.reduce((s, r) => s + r.actualHrs, 0) * 100) / 100,
    avgOtp:
      blockRows.length
        ? Math.round((blockRows.reduce((s, r) => s + r.otpPct, 0) / blockRows.length) * 10000) / 100
        : null,
  });

  res.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    byDay,
    tripsByRoute,
    workBlocks: {
      weekday: summarizeBlock(weekdayRows),
      weekend: summarizeBlock(weekendRows),
    },
  });
};
