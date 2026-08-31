import RunCutDay from "../models/RunCutDay.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { DAYS_OF_WEEK } from "../utils/hours.js";

export const getDailyScheduleReport = async (req, res) => {
  const { division, date } = req.query;
  if (!division || !date) {
    return res.status(400).json({ message: "division and date are required" });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const divisionDoc = await Division.findById(division);
  if (!divisionDoc) return res.status(404).json({ message: "Division not found" });

  const targetDate = new Date(date);
  const allDays = await RunCutDay.find({ division, date: targetDate })
    .populate("route", "code type")
    .populate("operator", "name")
    .populate("vehicle", "code")
    .populate("coveringRoute", "code")
    .sort({ "route.code": 1 });

  // A standby that's deployed to cover another route makes that route
  // actually operated today even though its own record still shows
  // "unassigned" (assigning a standby doesn't touch the covered route's own
  // fields) — so it needs to be reported using the covering standby's
  // operator/vehicle/schedule instead of its own empty ones.
  const coverageByRouteId = new Map();
  allDays
    .filter((d) => d.route?.type === "standby" && d.deployed && d.coveringRoute)
    .forEach((standbyDay) => {
      coverageByRouteId.set(standbyDay.coveringRoute._id.toString(), standbyDay);
    });

  // Unassigned duties have nothing to report to a client (no operator/
  // vehicle yet) UNLESS a standby is covering them, and standby capacity
  // itself isn't a client-facing route — a suspended route still shows
  // (highlighted) since that's real, useful information for the client.
  const rows = allDays
    .filter((r) => r.route?.type !== "standby")
    .filter((r) => r.status !== "off" && (r.status !== "unassigned" || coverageByRouteId.has(r.route?._id?.toString())))
    .map((r) => {
      const coveringStandby = coverageByRouteId.get(r.route?._id?.toString());
      return {
        route: r.route?.code ?? "",
        operator: coveringStandby ? coveringStandby.operator?.name ?? "" : r.operator?.name ?? "",
        vehicle: coveringStandby ? coveringStandby.vehicle?.code ?? "" : r.vehicle?.code ?? "",
        pulloutAddress: coveringStandby ? coveringStandby.pulloutAddress : r.pulloutAddress,
        startTime: coveringStandby ? coveringStandby.startTime : r.startTime,
        endTime: coveringStandby ? coveringStandby.endTime : r.endTime,
        status: r.status,
        clientNotes: coveringStandby
          ? [r.clientNotes, `Covered by standby ${coveringStandby.route?.code}`].filter(Boolean).join(" — ")
          : r.clientNotes,
      };
    });

  res.json({
    division: { id: divisionDoc._id, code: divisionDoc.code, name: divisionDoc.name },
    date: targetDate,
    dayOfWeek: DAYS_OF_WEEK[targetDate.getUTCDay()],
    rows,
  });
};
