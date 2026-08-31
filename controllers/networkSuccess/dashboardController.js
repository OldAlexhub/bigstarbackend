import Division from "../../models/Division.js";
import { canAccessDivision } from "../../middleware/access.js";
import { startOfWeek, addDays } from "../../utils/weeklyMetrics.js";
import { buildTrackerRows } from "../../utils/kpi/trackerRows.js";
import { routeDailyData, computeRankings, networkSummary } from "../../utils/kpi/rankings.js";
import { getEffectiveKpiSettings } from "../../utils/kpi/settings.js";
import { weeklySeries } from "../../utils/kpi/series.js";
import { computeStreaks } from "../../utils/kpi/streaks.js";

export const getDashboard = async (req, res) => {
  const { division: divisionId, weekStart: weekStartParam } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const kpiSettings = await getEffectiveKpiSettings(division);

  const rows = await buildTrackerRows(division._id, weekStart, weekEnd);
  const daily = routeDailyData(rows);
  const rankings = computeRankings(daily, kpiSettings);
  const summary = networkSummary(daily, rankings);

  const weeks = await weeklySeries(division, kpiSettings, weekStart, 4);
  const streaks = computeStreaks(weeks);

  res.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    rankings,
    summary,
    streaks,
    kpiSettings,
  });
};
