import Division from "../models/Division.js";
import User from "../models/User.js";
import ChangeLog from "../models/ChangeLog.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import Operator from "../models/Operator.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import Vehicle from "../models/Vehicle.js";
import WeeklyDivisionSummary from "../models/WeeklyDivisionSummary.js";
import NetworkSubmission from "../models/NetworkSubmission.js";
import NetworkRouteAlias from "../models/NetworkRouteAlias.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import OperationsKpiResult from "../models/OperationsKpiResult.js";
import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import ReallocationRequest from "../models/ReallocationRequest.js";
import TeamPost from "../models/TeamPost.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { ensureDefaultKpiSettings } from "../utils/operationsReporting.js";
import { runInTransaction } from "../utils/transaction.js";
import { getEffectiveThresholds } from "../utils/thresholds.js";
import { recomputeDivisionRunCutHours } from "../utils/recomputeRunCutHours.js";
import { todayInTimezone } from "../utils/timezone.js";

export const DIVISION_OWNED_MODELS = [
  DailyIssueLog,
  DeploymentActivityLog,
  DivisionThresholdChange,
  Operator,
  Route,
  RunCut,
  RunCutDay,
  Vehicle,
  WeeklyDivisionSummary,
  NetworkSubmission,
  NetworkRouteAlias,
  NetworkKpiEntry,
  CustomerServiceEntry,
  SafetyEntry,
  SafetyScoreEntry,
  OperationsKpiSetting,
  OperationsKpiResult,
  CorrectiveActionPlan,
  ReallocationRequest,
  TeamPost,
];

export const listDivisions = async (req, res) => {
  const includeInactive = req.query.includeInactive === "1" && req.user.role === "ELT";
  const divisions = await Division.find({
    ...divisionFilter(req.user),
    ...(includeInactive ? {} : { active: { $ne: false } }),
  })
    .sort({ code: 1 })
    .populate("parentDivision", "code name");
  res.json({ divisions });
};

export const createDivision = async (req, res) => {
  const { code, name, type, parentDivision, thresholds, timezone } = req.body;
  const breakMinutes = Number(thresholds?.breakMinutes);
  const revenueRatio = Number(thresholds?.revenueRatio);
  if (
    thresholds?.breakMinutes === null ||
    thresholds?.breakMinutes === undefined ||
    thresholds?.breakMinutes === "" ||
    thresholds?.revenueRatio === null ||
    thresholds?.revenueRatio === undefined ||
    thresholds?.revenueRatio === "" ||
    !Number.isFinite(breakMinutes) ||
    !Number.isFinite(revenueRatio)
  ) {
    return res.status(400).json({ message: "Break minutes and revenue ratio are required to create a division." });
  }
  const division = await Division.create({
    code,
    name,
    type,
    parentDivision,
    thresholds: { breakMinutes, revenueRatio },
    timezone,
  });
  // Seed the effective-dated history (server/models/DivisionThresholdChange.js)
  // so getEffectiveThresholds always has a real entry to resolve, from the
  // division's very first day forward, instead of only ever relying on the
  // undated fallback on Division itself.
  await DivisionThresholdChange.create({
    division: division._id,
    effectiveDate: todayInTimezone(timezone),
    breakMinutes,
    revenueRatio,
    createdBy: req.user._id,
  });
  await ensureDefaultKpiSettings([division]);
  res.status(201).json({ division });
};

export const updateDivision = async (req, res) => {
  const { id } = req.params;
  const division = await Division.findById(id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (!canAccessDivision(req.user, division._id)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const { name, active, thresholds, pulloutAddressRules } = req.body;
  if (name !== undefined) {
    if (req.user.role !== "ELT") {
      return res.status(403).json({ message: "ELT access is required to rename a division" });
    }
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ message: "Division name is required" });
    division.name = trimmedName;
  }
  if (active !== undefined) {
    if (req.user.role !== "ELT") {
      return res.status(403).json({ message: "ELT access is required to retire or restore a division" });
    }
    division.active = Boolean(active);
  }
  // A break minutes / revenue ratio change takes effect from a chosen start
  // date (default: today) instead of overwriting the current value outright,
  // so a change scheduled for the future doesn't touch what's shown for
  // dates before it, and a change effective today or earlier applies right
  // away. See server/models/DivisionThresholdChange.js and
  // server/utils/thresholds.js for how that history gets resolved.
  let pendingThresholdChange = null;
  if (thresholds !== undefined && (thresholds.breakMinutes !== undefined || thresholds.revenueRatio !== undefined)) {
    let breakMinutes = division.thresholds.breakMinutes;
    let revenueRatio = division.thresholds.revenueRatio;
    if (thresholds.breakMinutes !== undefined) {
      breakMinutes = Number(thresholds.breakMinutes);
      if (thresholds.breakMinutes === null || thresholds.breakMinutes === "" || !Number.isFinite(breakMinutes)) {
        return res.status(400).json({ message: "Break minutes is required for every division." });
      }
    }
    if (thresholds.revenueRatio !== undefined) {
      revenueRatio = Number(thresholds.revenueRatio);
      if (thresholds.revenueRatio === null || thresholds.revenueRatio === "" || !Number.isFinite(revenueRatio)) {
        return res.status(400).json({ message: "Revenue ratio is required for every division." });
      }
    }
    // Editing the division for an unrelated reason (renaming it, changing
    // its timezone) re-sends its current break minutes / revenue ratio
    // unchanged — only actually schedule a change, and only then recompute
    // every run cut in the division, when a submitted value is different.
    if (breakMinutes !== division.thresholds.breakMinutes || revenueRatio !== division.thresholds.revenueRatio) {
      let effectiveDate = thresholds.effectiveDate ? new Date(thresholds.effectiveDate) : todayInTimezone(division.timezone);
      if (Number.isNaN(effectiveDate.getTime())) {
        return res.status(400).json({ message: "Choose a valid start date for this break minutes / revenue ratio change." });
      }
      effectiveDate = new Date(Date.UTC(effectiveDate.getUTCFullYear(), effectiveDate.getUTCMonth(), effectiveDate.getUTCDate()));
      pendingThresholdChange = { breakMinutes, revenueRatio, effectiveDate };
    }
  }
  if (pulloutAddressRules !== undefined) {
    if (pulloutAddressRules.standbyKeepsRouteAddress !== undefined) {
      division.pulloutAddressRules.standbyKeepsRouteAddress = Boolean(pulloutAddressRules.standbyKeepsRouteAddress);
    }
    if (pulloutAddressRules.editableInLiveSchedule !== undefined) {
      division.pulloutAddressRules.editableInLiveSchedule = Boolean(pulloutAddressRules.editableInLiveSchedule);
    }
  }
  if (req.user.role === "ELT") {
    const { code, type, parentDivision, timezone } = req.body;
    if (code !== undefined) division.code = code;
    if (type !== undefined) division.type = type;
    if (parentDivision !== undefined) division.parentDivision = parentDivision;
    if (timezone !== undefined) division.timezone = timezone;
  }

  if (pendingThresholdChange) {
    await DivisionThresholdChange.findOneAndUpdate(
      { division: division._id, effectiveDate: pendingThresholdChange.effectiveDate },
      {
        breakMinutes: pendingThresholdChange.breakMinutes,
        revenueRatio: pendingThresholdChange.revenueRatio,
        createdBy: req.user._id,
      },
      { upsert: true }
    );
    // Cache what's effective as of today on the division itself — if the
    // change starts in the future this stays at the current value, since
    // that's still what's true today.
    const todayEffective = await getEffectiveThresholds(division, todayInTimezone(division.timezone));
    division.thresholds.breakMinutes = todayEffective.breakMinutes;
    division.thresholds.revenueRatio = todayEffective.revenueRatio;
  }

  await division.save();

  if (pendingThresholdChange) {
    await recomputeDivisionRunCutHours(division, req.user._id);
  }
  if (active === true) await ensureDefaultKpiSettings([division]);
  res.json({ division });
};

export const deleteDivision = async (req, res) => {
  const division = await Division.findById(req.params.id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (req.body?.confirmationCode !== division.code) {
    return res.status(400).json({ message: `Type ${division.code} to confirm permanent deletion` });
  }

  const divisionId = division._id;
  await runInTransaction(async () => {
    // MongoDB does not support parallel operations on the same transaction session.
    for (const Model of DIVISION_OWNED_MODELS) {
      await Model.deleteMany({ division: divisionId });
    }
    await ChangeLog.deleteMany({ entityType: "Division", entityId: divisionId });
    await User.updateMany(
      { divisionAccess: divisionId },
      { $pull: { divisionAccess: divisionId } }
    );
    await Division.updateMany(
      { parentDivision: divisionId },
      { $set: { parentDivision: null } }
    );
    await Division.deleteOne({ _id: divisionId });
  });

  res.json({
    message: "Division and all associated records were permanently deleted",
    deletedDivisionId: divisionId,
  });
};
