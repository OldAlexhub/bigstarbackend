import RunCut from "../../models/RunCut.js";
import { DAYS_OF_WEEK } from "../hours.js";
import { normalizeRouteGroup } from "./routeFamily.js";
import { dateKey, rowKey } from "./rowKeys.js";

const isoDatesInRange = (from, to) => {
  const dates = [];
  const cursor = new Date(new Date(from).toISOString().slice(0, 10));
  const end = new Date(new Date(to).toISOString().slice(0, 10));
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

// Finds every (route, date) in range that was actually scheduled to run but
// has no DailyKpiEntry at all, and returns them as synthesized closure rows
// in the same shape buildTrackerRows already produces - "absent from the
// data" is treated as a real closure against fulfillment, not silence.
//
// "Was it scheduled" is answered two ways, in priority order, because
// RunCut.daysOfWeek is a single mutable row with no history of its own -
// trustworthy for the current pattern, but not proof of what was true on an
// older date if the schedule has since changed:
//   1. A RunCutDay existing for that exact date is itself proof the route
//      was scheduled then (projectAssignment only ever creates one for a
//      date matching daysOfWeek at generation time) - trust its own
//      serviceHours/operator over the RunCut's current state.
//   2. Otherwise, fall back to matching the RunCut's *current* daysOfWeek
//      against that date's weekday - the best available answer for dates
//      old enough to predate any RunCutDay ever being generated.
// A route whose resolved scheduled hours come out to 0 (e.g. a RunCut
// that's persistently marked "off") isn't synthesized at all - there's
// nothing to be "closed" against.
export const findScheduleGaps = async ({ division, from, to, coveredKeys, runCutDayMap }) => {
  const runCuts = await RunCut.find({ division })
    .populate("route", "code")
    .populate({ path: "operator", populate: { path: "provider", select: "name" } });

  const dates = isoDatesInRange(from, to);
  const gaps = [];

  for (const rc of runCuts) {
    if (!rc.route) continue;

    for (const date of dates) {
      const key = rowKey(rc.route._id, date);
      if (coveredKeys.has(key)) continue; // a real DailyKpiEntry already covers this day

      const rcd = runCutDayMap.get(key);
      let schedHrs;
      let operatorName;
      let providerName;

      if (rcd) {
        schedHrs = rcd.serviceHours ?? 0;
        operatorName = rcd.operator?.name || "Unassigned";
        providerName = rcd.operator?.provider?.name || "Unassigned";
      } else {
        const weekday = DAYS_OF_WEEK[date.getUTCDay()];
        if (!rc.daysOfWeek.includes(weekday)) continue; // not scheduled that day at all
        schedHrs = rc.serviceHours ?? 0;
        operatorName = rc.operator?.name || "Unassigned";
        providerName = rc.operator?.provider?.name || "Unassigned";
      }

      if (schedHrs <= 0) continue;

      const routeSource = rc.route.code;
      const route = normalizeRouteGroup(routeSource);

      gaps.push({
        entryId: null, // nothing to edit/delete - this row was derived, not uploaded
        date: dateKey(date),
        operator: operatorName,
        provider: providerName,
        route,
        routeSource,
        schedHrs,
        actualHrs: 0,
        totalTrips: 0,
        otpPct: null, // excluded from OTP averaging via the existing isClosureOnly convention in rankings.js
        routeClosures: 1,
        lateToFirst: 0,
        lateDeploy: 0,
        closuresSource: "schedule-gap",
        kpiKey: `${providerName.toLowerCase()}|${route.toLowerCase()}`,
      });
    }
  }

  return gaps;
};
