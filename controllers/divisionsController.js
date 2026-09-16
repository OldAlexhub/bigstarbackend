import Division from "../models/Division.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { ensureDefaultKpiSettings } from "../utils/operationsReporting.js";

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
  if (name !== undefined) division.name = name;
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
  division.active = false;
  await division.save();
  res.json({ message: "Division retired; its historical data was preserved", division });
};
