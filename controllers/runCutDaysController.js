import RunCutDay from "../models/RunCutDay.js";
import Division from "../models/Division.js";
import Route from "../models/Route.js";
import { canAccessDivision } from "../middleware/access.js";
import { computeHours } from "../utils/hours.js";
import { getEffectiveThresholds } from "../utils/thresholds.js";
import { syncAutoIssuesBulk } from "../utils/autoIssueSync.js";
import { OSR_DISRUPTION_TYPE } from "../utils/disruptionTypes.js";
import { DISPOSITION_TYPES, STANDBY_DISPOSITION } from "../utils/dispositions.js";
import { logDeploymentActivity } from "../utils/deploymentActivityLog.js";
import {
  resolveOperator,
  resolveVehicle,
  resolveRoute,
  findOperatorConflictOnDate,
} from "../utils/resolveAssignment.js";

const isoDate = (date) => new Date(date).toISOString().slice(0, 10);

const populateRunCutDay = (query) =>
  query
    .populate("route", "code type")
    .populate("operator", "name")
    .populate("vehicle", "code")
    .populate("coveringRoute", "code");

const conflictMessage = (conflict) =>
  `This operator is already on route ${conflict.routeCode} from ${conflict.startTime} to ${conflict.endTime} ` +
  `that day — that overlaps with this duty.`;

export const listRunCutDays = async (req, res) => {
  const { division, from, to } = req.query;
  if (!division || !from || !to) {
    return res.status(400).json({ message: "division, from, and to are required" });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const runCutDays = await populateRunCutDay(
    RunCutDay.find({
      division,
      date: { $gte: new Date(from), $lte: new Date(to) },
    }).sort({ date: 1 })
  );

  const includeStandby = req.query.includeStandby === "1";
  res.json({
    runCutDays: includeStandby ? runCutDays : runCutDays.filter((rcd) => rcd.route?.type !== "standby"),
  });
};

// The one direct edit RunCutDay still allows on a normal scheduled day (see
// updateRunCutDayException for Deployment's day-specific edits): whether a
// standby duty was actually called in on this specific date, and if so,
// which scheduled route it's covering — deploying without saying which
// route it's covering isn't useful, so coveringRoute is required whenever
// deployed is being set to true, and is always cleared when set to false.
export const setRunCutDayDeployed = async (req, res) => {
  const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code type");
  if (!runCutDay) return res.status(404).json({ message: "Run cut day not found" });
  if (!canAccessDivision(req.user, runCutDay.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (runCutDay.route?.type !== "standby") {
    return res.status(400).json({ message: "Deployed can only be set on standby routes" });
  }

  const deployed = Boolean(req.body.deployed);
  const previousCoveringRoute = runCutDay.coveringRoute;
  let coveringRouteCode = null;
  let coveredRunCutDay = null;
  if (deployed) {
    const { coveringRoute } = req.body;
    if (!coveringRoute) {
      return res.status(400).json({ message: "Select which route this standby is covering." });
    }
    const routeDoc = await Route.findOne({ _id: coveringRoute, division: runCutDay.division });
    if (!routeDoc) return res.status(400).json({ message: "That route isn't in this division." });
    if (routeDoc.type === "standby") {
      return res.status(400).json({ message: "A standby can only cover a scheduled route." });
    }

    coveredRunCutDay = await RunCutDay.findOne({
      division: runCutDay.division,
      route: routeDoc._id,
      date: runCutDay.date,
    });
    if (!coveredRunCutDay) {
      return res.status(400).json({ message: "That route is not scheduled on this date." });
    }

    const duplicateCoverage = await RunCutDay.findOne({
      _id: { $ne: runCutDay._id },
      division: runCutDay.division,
      date: runCutDay.date,
      deployed: true,
      coveringRoute: routeDoc._id,
    });
    if (duplicateCoverage) {
      return res.status(409).json({ message: "That route is already covered by another standby." });
    }

    runCutDay.coveringRoute = routeDoc._id;
    coveringRouteCode = routeDoc.code;
  } else {
    runCutDay.coveringRoute = null;
  }

  runCutDay.deployed = deployed;
  runCutDay.updatedBy = req.user._id;
  await runCutDay.save();

  const coverageChanged =
    previousCoveringRoute &&
    (!deployed || String(previousCoveringRoute) !== String(runCutDay.coveringRoute));

  if (coverageChanged) {
    await RunCutDay.updateOne(
      {
        division: runCutDay.division,
        route: previousCoveringRoute,
        date: runCutDay.date,
        disposition: STANDBY_DISPOSITION,
        dispositionSource: "standby",
        dispositionStandbyDay: runCutDay._id,
      },
      {
        $set: {
          disposition: null,
          dispositionSource: null,
          dispositionStandbyDay: null,
          updatedBy: req.user._id,
        },
      }
    );
  }

  if (deployed && coveredRunCutDay) {
    coveredRunCutDay.disposition = STANDBY_DISPOSITION;
    coveredRunCutDay.dispositionSource = "standby";
    coveredRunCutDay.dispositionStandbyDay = runCutDay._id;
    coveredRunCutDay.updatedBy = req.user._id;
    await coveredRunCutDay.save();
  }

  logDeploymentActivity({
    division: runCutDay.division,
    user: req.user,
    action: "runcutday.deployed_set",
    summary: deployed
      ? `Marked standby ${runCutDay.route.code} deployed on ${isoDate(runCutDay.date)} (covering ${coveringRouteCode})`
      : `Marked standby ${runCutDay.route.code} not deployed on ${isoDate(runCutDay.date)}`,
  });

  const populated = await populateRunCutDay(RunCutDay.findById(runCutDay._id));
  res.json({ runCutDay: populated });
};

// Deployment's day-specific exception path: Status/Client Notes/Disruption/
// Disposition
// set here apply only to this date and are protected from the next
// projectAssignment run (server/utils/projectAssignment.js), which leaves
// an overridden field alone instead of replacing it with whatever the
// persistent RunCut assignment says. Operator/Vehicle/Pullout/Times are not
// editable here — those are Master Run Cuts' to manage.
export const updateRunCutDayException = async (req, res) => {
  const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code");
  if (!runCutDay) return res.status(404).json({ message: "Run cut day not found" });
  if (!canAccessDivision(req.user, runCutDay.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const { status, clientNotes, disruptionType, disruptionNotes, disposition } = req.body;
  const changeDescriptions = [];
  if (status !== undefined) {
    runCutDay.status = status;
    runCutDay.overrides.status = true;
    changeDescriptions.push(`status to ${status}`);
  }
  if (clientNotes !== undefined) {
    runCutDay.clientNotes = clientNotes;
    runCutDay.overrides.clientNotes = true;
    changeDescriptions.push("client notes");
  }
  if (disruptionType !== undefined || disruptionNotes !== undefined) {
    if (disruptionType !== undefined) runCutDay.disruptionType = disruptionType;
    if (disruptionNotes !== undefined) runCutDay.disruptionNotes = disruptionNotes;
    runCutDay.overrides.disruption = true;
    changeDescriptions.push(`disruption to ${disruptionType ?? runCutDay.disruptionType ?? "—"}`);
  }
  if (disposition !== undefined) {
    if (disposition !== null && !DISPOSITION_TYPES.includes(disposition)) {
      return res.status(400).json({ message: "Invalid disposition." });
    }
    if (runCutDay.dispositionSource === "standby") {
      if (disposition !== runCutDay.disposition) {
        return res.status(400).json({
          message: "Remove the standby coverage before changing this route's disposition.",
        });
      }
    } else {
      runCutDay.disposition = disposition || null;
      runCutDay.dispositionSource = disposition ? "manual" : null;
      runCutDay.dispositionStandbyDay = null;
    }
    changeDescriptions.push(`disposition to ${disposition || "not dispositioned"}`);
  }

  const divisionDoc = status !== undefined ? await Division.findById(runCutDay.division) : null;
  if (status !== undefined) {
    const thresholds = await getEffectiveThresholds(divisionDoc);
    const { serviceHours, revenueHours } = computeHours({
      startTime: runCutDay.startTime,
      endTime: runCutDay.endTime,
      status: runCutDay.status,
      ...thresholds,
    });
    runCutDay.serviceHours = serviceHours;
    runCutDay.revenueHours = revenueHours;
  }

  runCutDay.updatedBy = req.user._id;
  await runCutDay.save();

  if (changeDescriptions.length) {
    logDeploymentActivity({
      division: runCutDay.division,
      user: req.user,
      action: "runcutday.exception_updated",
      summary: `Updated ${runCutDay.route.code} on ${isoDate(runCutDay.date)}: set ${changeDescriptions.join(", ")}`,
    });
  }

  const affected = [runCutDay];

  // OSR is the one disruption type with an automated side effect: it also
  // suspends the route for tomorrow — a day-specific override on tomorrow's
  // RunCutDay, same as anything else set here, so it auto-reverts the day
  // after instead of touching the ongoing Master Run Cuts plan.
  if (disruptionType === OSR_DISRUPTION_TYPE) {
    const tomorrow = new Date(runCutDay.date);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDay = await RunCutDay.findOne({
      division: runCutDay.division,
      route: runCutDay.route,
      date: tomorrow,
    });
    if (tomorrowDay) {
      const thresholds = await getEffectiveThresholds(divisionDoc || (await Division.findById(runCutDay.division)));
      const { serviceHours, revenueHours } = computeHours({
        startTime: tomorrowDay.startTime,
        endTime: tomorrowDay.endTime,
        status: "suspended",
        ...thresholds,
      });
      tomorrowDay.status = "suspended";
      tomorrowDay.serviceHours = serviceHours;
      tomorrowDay.revenueHours = revenueHours;
      tomorrowDay.overrides.status = true;
      tomorrowDay.updatedBy = req.user._id;
      await tomorrowDay.save();
      affected.push(tomorrowDay);

      logDeploymentActivity({
        division: tomorrowDay.division,
        user: req.user,
        action: "runcutday.exception_updated",
        summary: `Auto-suspended ${runCutDay.route.code} on ${isoDate(tomorrowDay.date)} (OSR follow-through from ${isoDate(runCutDay.date)})`,
      });
    }
  }

  await syncAutoIssuesBulk(affected, req.user._id);

  const populated = await populateRunCutDay(RunCutDay.findById(runCutDay._id));
  res.json({ runCutDay: populated });
};

// An operator picking up revenue on a route/date outside its normal
// schedule — a one-off, not a change to the ongoing plan. Typing a
// route/operator/vehicle that doesn't exist yet creates it, same as Master
// Run Cuts' Add Route (server/utils/resolveAssignment.js).
export const createExtraRunCutDay = async (req, res) => {
  const { division, date, routeCode, operatorName, vehicleCode, pulloutAddress, startTime, endTime, notes } =
    req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!date || !routeCode) {
    return res.status(400).json({ message: "date and routeCode are required" });
  }

  const dayDate = new Date(date);
  const [route, operator, vehicle] = await Promise.all([
    resolveRoute(division, routeCode),
    resolveOperator(operatorName),
    resolveVehicle(division, vehicleCode),
  ]);

  const conflict = await findOperatorConflictOnDate({ operator, date: dayDate, startTime, endTime });
  if (conflict) return res.status(409).json({ message: conflictMessage(conflict) });

  const divisionDoc = await Division.findById(division);
  const thresholds = await getEffectiveThresholds(divisionDoc);
  const { serviceHours, revenueHours } = computeHours({
    startTime,
    endTime,
    status: "add_rte",
    ...thresholds,
  });

  let runCutDay;
  try {
    runCutDay = await RunCutDay.create({
      division,
      route: route._id,
      date: dayDate,
      operator,
      vehicle,
      pulloutAddress,
      startTime,
      endTime,
      status: "add_rte",
      serviceHours,
      revenueHours,
      clientNotes: notes || "",
      isExtra: true,
      overrides: { status: true, clientNotes: true, disruption: false },
      updatedBy: req.user._id,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "This route already has a scheduled duty on this date." });
    }
    throw error;
  }

  logDeploymentActivity({
    division,
    user: req.user,
    action: "runcutday.extra_added",
    summary: `Added extra run for ${route.code} on ${isoDate(dayDate)}${operatorName ? ` (operator: ${operatorName})` : ""}`,
  });

  const populated = await populateRunCutDay(RunCutDay.findById(runCutDay._id));
  res.status(201).json({ runCutDay: populated });
};

export const deleteExtraRunCutDay = async (req, res) => {
  const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code");
  if (!runCutDay) return res.status(404).json({ message: "Run cut day not found" });
  if (!canAccessDivision(req.user, runCutDay.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!runCutDay.isExtra) {
    return res.status(400).json({ message: "Only an extra duty added here can be removed this way." });
  }

  logDeploymentActivity({
    division: runCutDay.division,
    user: req.user,
    action: "runcutday.extra_removed",
    summary: `Removed extra run for ${runCutDay.route.code} on ${isoDate(runCutDay.date)}`,
  });

  await runCutDay.deleteOne();
  res.json({ message: "Extra duty removed" });
};
