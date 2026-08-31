import NSSettings from "../../models/NSSettings.js";
import { weightsSumTo1 } from "../../utils/kpi/settings.js";

export const getNsSettings = async (req, res) => {
  const settings = await NSSettings.getSingleton();
  res.json({ settings });
};

export const updateNsSettings = async (req, res) => {
  const settings = await NSSettings.getSingleton();
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
    if (req.body[key] !== undefined) settings[key] = req.body[key];
  }

  if (req.body.weights) {
    const weightKeys = ["otp", "shf", "tpsh", "routeClosure", "lateFirst", "lateDeploy"];
    const nextWeights = { ...settings.weights.toObject(), ...req.body.weights };
    if (!weightsSumTo1(nextWeights)) {
      return res.status(400).json({ message: "Weights must sum to 100%." });
    }
    for (const key of weightKeys) {
      if (req.body.weights[key] !== undefined) settings.weights[key] = req.body.weights[key];
    }
  }

  await settings.save();
  res.json({ settings });
};
