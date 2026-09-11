import Settings from "../models/Settings.js";
import mongoose from "mongoose";
import Division from "../models/Division.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import User from "../models/User.js";
import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import { divisionFilter } from "../middleware/access.js";
import { KPI_DEFINITIONS, KPI_KEYS, isCalendarMonth } from "../utils/operationsKpis.js";
import { ensureDefaultKpiSettings, queueOperationsRangeRefresh } from "../utils/operationsReporting.js";

export const getSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  res.json({ settings });
};

export const updateSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  const { breakMinutes, revenueRatio, operationsReportingStartMonth } = req.body;
  if (breakMinutes !== undefined) settings.breakMinutes = breakMinutes;
  if (revenueRatio !== undefined) settings.revenueRatio = revenueRatio;
  if (operationsReportingStartMonth !== undefined) {
    if (!isCalendarMonth(operationsReportingStartMonth)) {
      return res.status(400).json({ message: "Choose a valid CAP activation month." });
    }
    settings.operationsReportingStartMonth = operationsReportingStartMonth;
  }
  await settings.save();
  res.json({ settings });
};

export const getOperationsKpiSettings = async (req, res) => {
  const divisions = await Division.find({ ...divisionFilter(req.user), active: true }).sort({ code: 1 });
  await ensureDefaultKpiSettings(divisions);
  const settings = await OperationsKpiSetting.find({ division: { $in: divisions.map((division) => division._id) } })
    .populate("assignedManager", "name role")
    .sort({ division: 1, kpiKey: 1, effectiveMonth: 1 });
  const singleton = await Settings.getSingleton();
  res.json({ definitions: KPI_DEFINITIONS, settings, operationsReportingStartMonth: singleton.operationsReportingStartMonth });
};

export const saveOperationsKpiSetting = async (req, res) => {
  const { division, kpiKey, effectiveMonth, enabled, direction, target, redCutoff, assignedManager } = req.body;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a valid division." });
  if (!KPI_KEYS.includes(kpiKey)) return res.status(400).json({ message: "Choose a valid KPI." });
  if (!isCalendarMonth(effectiveMonth)) return res.status(400).json({ message: "Choose a valid effective month." });
  if (!["higher", "lower"].includes(direction)) return res.status(400).json({ message: "Choose whether higher or lower is better." });
  const parsedTarget = Number(target);
  const parsedCutoff = Number(redCutoff);
  if (!Number.isFinite(parsedTarget) || !Number.isFinite(parsedCutoff)) return res.status(400).json({ message: "Target and Red cutoff must be numbers." });
  if (direction === "higher" && parsedCutoff >= parsedTarget) return res.status(400).json({ message: "For higher-is-better KPIs, the Red cutoff must be below the target." });
  if (direction === "lower" && parsedCutoff <= parsedTarget) return res.status(400).json({ message: "For lower-is-better KPIs, the Red cutoff must be above the target." });
  const divisionDoc = await Division.findById(division);
  if (!divisionDoc) return res.status(404).json({ message: "Division not found." });

  let manager = null;
  if (assignedManager) {
    if (!mongoose.isValidObjectId(assignedManager)) return res.status(400).json({ message: "Choose a valid manager." });
    manager = await User.findOne({ _id: assignedManager, active: true });
    if (!manager) return res.status(400).json({ message: "The selected manager is unavailable." });
    const hasDivision = manager.role === "ELT" || manager.divisionAccess.some((value) => String(value) === String(division));
    if (!hasDivision) return res.status(400).json({ message: "The selected manager does not have access to this division." });
    if (manager.role !== "ELT" && !manager.sections.includes("operations_reporting")) {
      return res.status(400).json({ message: "The selected manager needs Operations Reporting access." });
    }
  }

  const setting = await OperationsKpiSetting.findOneAndUpdate(
    { division, kpiKey, effectiveMonth },
    {
      $set: {
        enabled: Boolean(enabled),
        direction,
        target: parsedTarget,
        redCutoff: parsedCutoff,
        assignedManager: manager?._id || null,
        updatedBy: req.user._id,
      },
      $setOnInsert: { createdBy: req.user._id },
    },
    { upsert: true, new: true, runValidators: true }
  ).populate("assignedManager", "name role");
  if (manager) {
    const unassignedCaps = await CorrectiveActionPlan.find({ division, kpiKey, activeEpisode: true, assignedManager: null });
    for (const cap of unassignedCaps) {
      cap.assignedManager = manager._id;
      cap.audit.push({ action: "manager_assigned_from_settings", changedBy: req.user._id, details: { effectiveMonth } });
      await cap.save();
    }
  }
  queueOperationsRangeRefresh(division, effectiveMonth);
  res.json({ setting });
};
