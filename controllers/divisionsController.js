import Division from "../models/Division.js";
import User from "../models/User.js";
import ChangeLog from "../models/ChangeLog.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
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

export const DIVISION_OWNED_MODELS = [
  DailyIssueLog,
  DeploymentActivityLog,
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
  const division = await Division.create({ code, name, type, parentDivision, thresholds, timezone });
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

  const { name, active, thresholds } = req.body;
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
  if (thresholds !== undefined) {
    if (thresholds.breakMinutes !== undefined) division.thresholds.breakMinutes = thresholds.breakMinutes;
    if (thresholds.revenueRatio !== undefined) division.thresholds.revenueRatio = thresholds.revenueRatio;
  }
  if (req.user.role === "ELT") {
    const { code, type, parentDivision, timezone } = req.body;
    if (code !== undefined) division.code = code;
    if (type !== undefined) division.type = type;
    if (parentDivision !== undefined) division.parentDivision = parentDivision;
    if (timezone !== undefined) division.timezone = timezone;
  }

  await division.save();
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
