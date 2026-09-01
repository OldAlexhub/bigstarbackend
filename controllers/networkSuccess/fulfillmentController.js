import Division from "../../models/Division.js";
import RunCut from "../../models/RunCut.js";
import { canAccessDivision } from "../../middleware/access.js";
import { normalizeRouteGroup } from "../../utils/kpi/routeFamily.js";
import { getEffectiveKpiSettings } from "../../utils/kpi/settings.js";
import { DAYS_OF_WEEK } from "../../utils/hours.js";

const durationHours = (startTime, endTime) => {
  if (!startTime || !endTime) return 0;
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  let minutes = toMinutes(endTime) - toMinutes(startTime);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
};

export const getFulfillmentBrain = async (req, res) => {
  const { division: divisionId, days, targetPct } = req.query;
  if (!divisionId) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, divisionId)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: "Division not found" });

  const selectedDays = days ? days.split(",") : ["MON", "TUE", "WED", "THU", "FRI"];
  const target = targetPct ? Number(targetPct) : 0.95;
  const kpiSettings = await getEffectiveKpiSettings(division);

  const runCuts = await RunCut.find({ division: divisionId, daysOfWeek: { $in: selectedDays } })
    .populate("route", "code")
    .populate("operator", "name active");

  const dutyMap = new Map();
  for (const rc of runCuts) {
    if (!rc.route) continue;
    const family = normalizeRouteGroup(rc.route.code);
    const hours = durationHours(rc.startTime, rc.endTime);
    const revenueHours = Math.max(hours - kpiSettings.revenueHourDeduction, 0) * kpiSettings.revenueHourMultiplier;
    const isActive = rc.operator?.active ?? false;

    // One RunCut can cover several of the selected days at once (daysOfWeek
    // is an array) - each matched day is its own duty needing coverage.
    for (const day of rc.daysOfWeek.filter((d) => selectedDays.includes(d))) {
      const key = `${day}|${family}`;
      if (!dutyMap.has(key)) {
        dutyMap.set(key, { dayOfWeek: day, route: family, covered: false, hours: 0 });
      }
      const duty = dutyMap.get(key);
      duty.hours = Math.max(duty.hours, revenueHours);
      if (isActive) duty.covered = true;
    }
  }

  const duties = Array.from(dutyMap.values());
  const byDay = {};
  DAYS_OF_WEEK.filter((d) => selectedDays.includes(d)).forEach((day) => {
    const dayDuties = duties.filter((d) => d.dayOfWeek === day);
    const scheduledHours = dayDuties.reduce((s, d) => s + d.hours, 0);
    const coveredHours = dayDuties.filter((d) => d.covered).reduce((s, d) => s + d.hours, 0);
    byDay[day] = {
      scheduledDuties: dayDuties.length,
      coveredDuties: dayDuties.filter((d) => d.covered).length,
      scheduledHours: Math.round(scheduledHours * 100) / 100,
      coveredHours: Math.round(coveredHours * 100) / 100,
    };
  });

  const totalScheduledDuties = duties.length;
  const totalCoveredDuties = duties.filter((d) => d.covered).length;
  const totalScheduledHours = duties.reduce((s, d) => s + d.hours, 0);
  const totalCoveredHours = duties.filter((d) => d.covered).reduce((s, d) => s + d.hours, 0);

  const dutyFulfillmentPct = totalScheduledDuties ? totalCoveredDuties / totalScheduledDuties : null;
  const hourFulfillmentPct = totalScheduledHours ? totalCoveredHours / totalScheduledHours : null;

  // Scenario planner: inactive, route-assigned operators ranked by the core
  // hours activating them would add, highest first.
  const inactiveCandidates = runCuts
    .filter((rc) => rc.operator && rc.operator.active === false && rc.route)
    .flatMap((rc) => {
      const family = normalizeRouteGroup(rc.route.code);
      const hours = durationHours(rc.startTime, rc.endTime);
      const revenueHours = Math.max(hours - kpiSettings.revenueHourDeduction, 0) * kpiSettings.revenueHourMultiplier;
      return rc.daysOfWeek
        .filter((d) => selectedDays.includes(d))
        .map((day) => ({
          operatorId: rc.operator._id,
          operatorName: rc.operator.name,
          route: family,
          dayOfWeek: day,
          addedHours: Math.round(revenueHours * 100) / 100,
        }));
    })
    .sort((a, b) => b.addedHours - a.addedHours);

  const remainingDuties = Math.max(0, Math.ceil(totalScheduledDuties * target) - totalCoveredDuties);

  res.json({
    days: selectedDays,
    targetPct: target,
    byDay,
    summary: {
      totalScheduledDuties,
      totalCoveredDuties,
      totalScheduledHours: Math.round(totalScheduledHours * 100) / 100,
      totalCoveredHours: Math.round(totalCoveredHours * 100) / 100,
      dutyFulfillmentPct,
      hourFulfillmentPct,
      remainingDutiesToTarget: remainingDuties,
    },
    inactiveCandidates,
  });
};
