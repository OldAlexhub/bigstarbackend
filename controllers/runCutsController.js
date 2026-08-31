import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import ChangeLog from "../models/ChangeLog.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { computeHours } from "../utils/hours.js";
import { getEffectiveThresholds } from "../utils/thresholds.js";
import { projectAssignment } from "../utils/projectAssignment.js";
import {
  resolveOperator,
  resolveVehicle,
  findOperatorConflict,
  findVehicleConflictIds,
} from "../utils/resolveAssignment.js";

const populateRunCut = (query) =>
  query
    .populate("route", "code type")
    .populate("operator", "name")
    .populate("vehicle", "code")
    .populate("division", "code name");

const excludeStandby = (runCuts, includeStandby) =>
  includeStandby ? runCuts : runCuts.filter((rc) => rc.route?.type !== "standby");

const conflictMessage = (conflict) =>
  `This operator is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime} — that overlaps with this assignment.`;

// Flags rows whose vehicle is double-booked (same vehicle, overlapping day
// + time) against another row in the same result set — reusing a vehicle
// across non-overlapping shifts is normal and left unflagged.
const withVehicleConflictFlags = (runCuts) => {
  const conflictIds = findVehicleConflictIds(runCuts);
  return runCuts.map((rc) => {
    const plain = rc.toObject ? rc.toObject() : rc;
    return { ...plain, vehicleConflict: conflictIds.has(rc._id.toString()) };
  });
};

export const listRunCuts = async (req, res) => {
  const includeStandby = req.query.includeStandby === "1";

  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const runCuts = await populateRunCut(RunCut.find({ division: req.query.division }));
    return res.json({ runCuts: withVehicleConflictFlags(excludeStandby(runCuts, includeStandby)) });
  }

  const accessibleDivisionIds = await Division.find(divisionFilter(req.user)).distinct("_id");
  const runCuts = await populateRunCut(RunCut.find({ division: { $in: accessibleDivisionIds } }));
  res.json({ runCuts: withVehicleConflictFlags(excludeStandby(runCuts, includeStandby)) });
};

export const createRunCut = async (req, res) => {
  const { division, route, daysOfWeek, operatorName, vehicleCode, pulloutAddress, startTime, endTime, status } =
    req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const [operator, vehicle] = await Promise.all([resolveOperator(operatorName), resolveVehicle(division, vehicleCode)]);

  const conflict = await findOperatorConflict({
    operator,
    daysOfWeek: daysOfWeek || [],
    startTime,
    endTime,
  });
  if (conflict) return res.status(409).json({ message: conflictMessage(conflict) });

  const divisionDoc = await Division.findById(division);
  const thresholds = await getEffectiveThresholds(divisionDoc);
  const resolvedStatus = status || "active";
  const { serviceHours, revenueHours } = computeHours({
    startTime,
    endTime,
    status: resolvedStatus,
    ...thresholds,
  });

  const runCut = await RunCut.create({
    division,
    route,
    daysOfWeek: daysOfWeek || [],
    operator,
    vehicle,
    pulloutAddress,
    startTime,
    endTime,
    status: resolvedStatus,
    serviceHours,
    revenueHours,
    updatedBy: req.user._id,
  });

  await projectAssignment(runCut, req.user._id);
  const populated = await populateRunCut(RunCut.findById(runCut._id));
  res.status(201).json({ runCut: populated });
};

export const updateRunCut = async (req, res) => {
  const runCut = await RunCut.findById(req.params.id);
  if (!runCut) return res.status(404).json({ message: "Run cut not found" });
  if (!canAccessDivision(req.user, runCut.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const body = { ...req.body };
  if (body.operatorName !== undefined) {
    body.operator = await resolveOperator(body.operatorName);
    delete body.operatorName;
  }
  if (body.vehicleCode !== undefined) {
    body.vehicle = await resolveVehicle(runCut.division, body.vehicleCode);
    delete body.vehicleCode;
  }

  const editableFields = [
    "daysOfWeek",
    "operator",
    "vehicle",
    "pulloutAddress",
    "startTime",
    "endTime",
    "status",
    "clientNotes",
    "disruptionType",
    "disruptionNotes",
  ];
  const changes = [];
  for (const field of editableFields) {
    if (body[field] === undefined) continue;
    const oldValue = runCut[field];
    const newValue = body[field];
    const changed =
      field === "daysOfWeek"
        ? JSON.stringify([...(oldValue || [])].sort()) !== JSON.stringify([...(newValue || [])].sort())
        : String(oldValue ?? "") !== String(newValue ?? "");
    if (changed) {
      changes.push({ field, oldValue, newValue });
      runCut[field] = newValue;
    }
  }

  const conflict = await findOperatorConflict({
    operator: runCut.operator,
    daysOfWeek: runCut.daysOfWeek,
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    excludeRunCutId: runCut._id,
  });
  if (conflict) return res.status(409).json({ message: conflictMessage(conflict) });

  const divisionDoc = await Division.findById(runCut.division);
  const thresholds = await getEffectiveThresholds(divisionDoc);
  const { serviceHours, revenueHours } = computeHours({
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    ...thresholds,
  });
  runCut.serviceHours = serviceHours;
  runCut.revenueHours = revenueHours;
  runCut.updatedBy = req.user._id;

  await runCut.save();
  await projectAssignment(runCut, req.user._id);

  if (changes.length) {
    await ChangeLog.insertMany(
      changes.map((change) => ({
        entityType: "RunCut",
        entityId: runCut._id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy: req.user._id,
      }))
    );
  }

  const populated = await populateRunCut(RunCut.findById(runCut._id));

  // A vehicle/day/time edit can change which OTHER rows in the division are
  // now (or no longer) double-booked, not just this one — recomputed here
  // and sent back alongside the edited row so the client can patch every
  // affected row's flag in place instead of reloading the whole division's
  // list (the previous full-reload was the visible "refresh" on every edit).
  const divisionRunCuts = await RunCut.find({ division: runCut.division }, "vehicle daysOfWeek startTime endTime");
  const conflictIds = findVehicleConflictIds(divisionRunCuts);
  const vehicleConflicts = Object.fromEntries(
    divisionRunCuts.map((rc) => [rc._id.toString(), conflictIds.has(rc._id.toString())])
  );

  res.json({ runCut: populated, vehicleConflicts });
};

export const deleteRunCut = async (req, res) => {
  const runCut = await RunCut.findById(req.params.id);
  if (!runCut) return res.status(404).json({ message: "Run cut not found" });
  if (!canAccessDivision(req.user, runCut.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  runCut.daysOfWeek = [];
  await projectAssignment(runCut, req.user._id);
  await runCut.deleteOne();
  res.json({ message: "Run cut deleted" });
};
