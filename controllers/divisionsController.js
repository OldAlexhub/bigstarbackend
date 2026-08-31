import Division from "../models/Division.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";

export const listDivisions = async (req, res) => {
  const divisions = await Division.find(divisionFilter(req.user))
    .sort({ code: 1 })
    .populate("parentDivision", "code name");
  res.json({ divisions });
};

export const createDivision = async (req, res) => {
  const { code, name, type, parentDivision, thresholds, timezone } = req.body;
  const division = await Division.create({ code, name, type, parentDivision, thresholds, timezone });
  res.status(201).json({ division });
};

export const updateDivision = async (req, res) => {
  const { id } = req.params;
  const division = await Division.findById(id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (!canAccessDivision(req.user, division._id)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const { name, active, thresholds, kpiSettings } = req.body;
  if (name !== undefined) division.name = name;
  if (active !== undefined) division.active = active;
  if (thresholds !== undefined) {
    if (thresholds.breakMinutes !== undefined) division.thresholds.breakMinutes = thresholds.breakMinutes;
    if (thresholds.revenueRatio !== undefined) division.thresholds.revenueRatio = thresholds.revenueRatio;
  }
  if (kpiSettings !== undefined) {
    const scalarKeys = [
      "otpThresh",
      "shfThresh",
      "tpshBench",
      "routeClosureBench",
      "lateFirstBench",
      "lateDeployBench",
      "scoreCap",
      "revenueHourDeduction",
      "revenueHourMultiplier",
    ];
    for (const key of scalarKeys) {
      if (kpiSettings[key] !== undefined) division.kpiSettings[key] = kpiSettings[key];
    }
    if (kpiSettings.weights !== undefined) {
      const weightKeys = ["otp", "shf", "tpsh", "routeClosure", "lateFirst", "lateDeploy"];
      for (const key of weightKeys) {
        if (kpiSettings.weights[key] !== undefined) {
          division.kpiSettings.weights[key] = kpiSettings.weights[key];
        }
      }
    }
  }
  if (req.user.role === "ELT") {
    const { code, type, parentDivision, timezone } = req.body;
    if (code !== undefined) division.code = code;
    if (type !== undefined) division.type = type;
    if (parentDivision !== undefined) division.parentDivision = parentDivision;
    if (timezone !== undefined) division.timezone = timezone;
  }

  await division.save();
  res.json({ division });
};

export const deleteDivision = async (req, res) => {
  const division = await Division.findByIdAndDelete(req.params.id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  res.json({ message: "Division deleted" });
};
