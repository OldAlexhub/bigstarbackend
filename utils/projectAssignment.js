import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Division from "../models/Division.js";
import { DAYS_OF_WEEK, computeHours } from "./hours.js";
import { getEffectiveThresholds } from "./thresholds.js";
import { syncAutoIssuesBulk } from "./autoIssueSync.js";
import { todayInTimezone } from "./timezone.js";

// 6 days: guarantees the current calendar week is always fully generated
// (worst case, "today" is Monday) — the furthest any consumer actually
// reads (Tracker/home summary cap at the current week; Deployment caps at
// tomorrow). Anything further out was pure unread waste.
export const PROJECTION_HORIZON_DAYS = 6;

const dayOfWeekFor = (date) => DAYS_OF_WEEK[new Date(date).getUTCDay()];

// Projects a live RunCut (the single, always-current assignment for a route)
// forward into dated RunCutDay records — the shape Tracker/KPI/Issue Log
// already read. Runs from today through the horizon so a change is visible
// everywhere immediately; past dates are never touched, so real history
// (what actually happened on a day that's already gone by) stays intact.
//
// Status/clientNotes/disruption can be overridden per date by Deployment
// (see runCutDaysController.updateRunCutDayException) — those fields, and
// serviceHours/revenueHours since they depend on status ("off" days have
// none), are left alone on an overridden date instead of being replaced by
// the persistent assignment's value. A date only ever carries its own
// override, so the next scheduled day (a different, never-overridden
// document) naturally reverts to the plan — no explicit "clear" needed.
export const projectAssignment = async (runCut, userId, { horizonDays = PROJECTION_HORIZON_DAYS } = {}) => {
  const divisionDoc = await Division.findById(runCut.division);
  const thresholds = await getEffectiveThresholds(divisionDoc);
  const start = todayInTimezone(divisionDoc?.timezone);

  const dates = [];
  for (let i = 0; i <= horizonDays; i += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date);
  }

  const keepDates = dates.filter((d) => runCut.daysOfWeek.includes(dayOfWeekFor(d)));
  const dropDates = dates.filter((d) => !runCut.daysOfWeek.includes(dayOfWeekFor(d)));

  if (dropDates.length) {
    const removable = await RunCutDay.find({
      division: runCut.division,
      route: runCut.route,
      date: { $in: dropDates },
      isExtra: { $ne: true },
    }).select("_id");
    const removableIds = removable.map((r) => r._id);
    if (removableIds.length) {
      await DailyIssueLog.deleteMany({ runCutDay: { $in: removableIds }, autoSyncTag: { $ne: null } });
      await RunCutDay.deleteMany({ _id: { $in: removableIds } });
    }
  }

  if (!keepDates.length) return;

  const { serviceHours, revenueHours } = computeHours({
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    ...thresholds,
  });

  await RunCutDay.bulkWrite(
    keepDates.map((date) => ({
      updateOne: {
        filter: { division: runCut.division, route: runCut.route, date },
        update: [
          {
            $set: {
              division: { $ifNull: ["$division", runCut.division] },
              route: { $ifNull: ["$route", runCut.route] },
              date: { $ifNull: ["$date", date] },
              operator: runCut.operator,
              vehicle: runCut.vehicle,
              pulloutAddress: runCut.pulloutAddress,
              startTime: runCut.startTime,
              endTime: runCut.endTime,
              updatedBy: userId,
              status: { $cond: ["$overrides.status", "$status", runCut.status] },
              serviceHours: { $cond: ["$overrides.status", "$serviceHours", serviceHours] },
              revenueHours: { $cond: ["$overrides.status", "$revenueHours", revenueHours] },
              clientNotes: { $cond: ["$overrides.clientNotes", "$clientNotes", runCut.clientNotes] },
              disruptionType: { $cond: ["$overrides.disruption", "$disruptionType", runCut.disruptionType] },
              disruptionNotes: { $cond: ["$overrides.disruption", "$disruptionNotes", runCut.disruptionNotes] },
            },
          },
        ],
        upsert: true,
      },
    }))
  );

  const runCutDays = await RunCutDay.find({
    division: runCut.division,
    route: runCut.route,
    date: { $in: keepDates },
  });
  await syncAutoIssuesBulk(runCutDays, userId);
};
