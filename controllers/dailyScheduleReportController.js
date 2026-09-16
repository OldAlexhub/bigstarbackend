import RunCutDay from "../models/RunCutDay.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { DAYS_OF_WEEK } from "../utils/hours.js";
import { getBranchGroupDivisionIds } from "../utils/divisionBranches.js";

const dailyChangeLabel = (status) =>
  ({
    active: "Active",
    unassigned: "Unassigned",
    suspended: "Suspended",
    off: "Off",
    add_rte: "Additional Revenue Route",
    removed: "Removed",
  })[status] || status || "Updated";

const EXCEPTION_OVERRIDE_FIELDS = [
  "operator",
  "vehicle",
  "pulloutAddress",
  "startTime",
  "endTime",
  "status",
  "clientNotes",
  "disruption",
];

export const hasDailyScheduleException = (day) =>
  Boolean(
    day?.isExtra ||
    EXCEPTION_OVERRIDE_FIELDS.some((field) => day?.overrides?.[field] === true)
  );

export const exceptionRowsForReport = (rows) =>
  (rows || [])
    .filter((row) => row.isException)
    .map(({ isException: _isException, ...row }) => ({
      ...row,
      dailyChanges: dailyChangeLabel(row.status),
    }));

const withoutExceptionMarker = ({ isException: _isException, ...row }) => row;

const parseReportRequest = async (req, res) => {
  const { division, date } = req.query;
  if (!division || !date) {
    res.status(400).json({ message: "division and date are required" });
    return null;
  }
  if (!canAccessDivision(req.user, division)) {
    res.status(403).json({ message: "No access to this division" });
    return null;
  }

  const divisionDoc = await Division.findById(division);
  if (!divisionDoc) {
    res.status(404).json({ message: "Division not found" });
    return null;
  }

  const targetDate = new Date(date);
  if (Number.isNaN(targetDate.getTime())) {
    res.status(400).json({ message: "Choose a valid report date" });
    return null;
  }

  return { division, divisionDoc, targetDate };
};

const loadScheduleRows = async ({ division, targetDate }) => {
  const branchDivisionIds = await getBranchGroupDivisionIds(division);
  const poolDays = await RunCutDay.find({ division: { $in: branchDivisionIds }, date: targetDate })
    .populate("route", "code type")
    .populate("operator", "name")
    .populate("vehicle", "code")
    .populate("coveringRoute", "code")
    .sort({ "route.code": 1 });
  const allDays = poolDays.filter(
    (day) => String(day.division) === String(division) || day.route?.type === "standby"
  );

  // A standby covering a route supplies that route's actual operator,
  // vehicle, pullout, and schedule in both the full report and Updates.
  const coverageByRouteId = new Map();
  allDays
    .filter((day) => day.route?.type === "standby" && day.deployed && day.coveringRoute)
    .forEach((standbyDay) => {
      coverageByRouteId.set(standbyDay.coveringRoute._id.toString(), standbyDay);
    });

  const allRows = allDays
    .filter((day) => day.route?.type !== "standby")
    .map((day) => {
      const coveringStandby = coverageByRouteId.get(day.route?._id?.toString());
      return {
        routeId: day.route?._id?.toString() ?? "",
        route: day.route?.code ?? "",
        operator: coveringStandby ? coveringStandby.operator?.name ?? "" : day.operator?.name ?? "",
        vehicle: coveringStandby ? coveringStandby.vehicle?.code ?? "" : day.vehicle?.code ?? "",
        pulloutAddress: coveringStandby ? coveringStandby.pulloutAddress : day.pulloutAddress,
        startTime: coveringStandby ? coveringStandby.startTime : day.startTime,
        endTime: coveringStandby ? coveringStandby.endTime : day.endTime,
        status: day.status,
        clientNotes: coveringStandby
          ? [day.clientNotes, `Covered by standby ${coveringStandby.route?.code}`].filter(Boolean).join(" — ")
          : day.clientNotes,
        coveredByStandby: Boolean(coveringStandby),
        isException: hasDailyScheduleException(day) || Boolean(coveringStandby),
      };
    });

  // Off routes and uncovered, unassigned routes are omitted from the full
  // client schedule, but retained in allRows so day-specific exceptions can
  // still appear in the Updates template.
  const rows = allRows.filter(
    (row) => row.status !== "off" && (row.status !== "unassigned" || row.coveredByStandby)
  );

  return { rows, allRows };
};

const reportMetadata = ({ divisionDoc, targetDate }) => ({
  division: { id: divisionDoc._id, code: divisionDoc.code, name: divisionDoc.name },
  date: targetDate,
  dayOfWeek: DAYS_OF_WEEK[targetDate.getUTCDay()],
});

export const getDailyScheduleReport = async (req, res) => {
  const parsed = await parseReportRequest(req, res);
  if (!parsed) return;

  const { rows, allRows } = await loadScheduleRows(parsed);
  const metadata = reportMetadata(parsed);

  if (req.query.mode === "updates") {
    return res.json({
      ...metadata,
      rows: exceptionRowsForReport(allRows),
    });
  }

  res.json({ ...metadata, rows: rows.map(withoutExceptionMarker) });
};
