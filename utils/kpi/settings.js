import NSSettings from "../../models/NSSettings.js";

const SCALAR_KEYS = [
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

const WEIGHT_KEYS = ["otp", "shf", "tpsh", "routeClosure", "lateFirst", "lateDeploy"];

export const getEffectiveKpiSettings = async (division) => {
  const defaults = await NSSettings.getSingleton();
  const override = division?.kpiSettings || {};

  const resolved = {};
  for (const key of SCALAR_KEYS) {
    resolved[key] = override[key] ?? defaults[key];
  }

  const overrideWeights = override.weights || {};
  const hasAnyOverrideWeight = WEIGHT_KEYS.some((key) => overrideWeights[key] != null);
  resolved.weights = {};
  for (const key of WEIGHT_KEYS) {
    resolved.weights[key] = hasAnyOverrideWeight
      ? overrideWeights[key] ?? 0
      : defaults.weights[key];
  }

  return resolved;
};

export const weightsSumTo1 = (weights, tolerance = 0.001) => {
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
  return Math.abs(total - 1) <= tolerance;
};
