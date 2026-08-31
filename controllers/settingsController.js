import Settings from "../models/Settings.js";

export const getSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  res.json({ settings });
};

export const updateSettings = async (req, res) => {
  const settings = await Settings.getSingleton();
  const { breakMinutes, revenueRatio } = req.body;
  if (breakMinutes !== undefined) settings.breakMinutes = breakMinutes;
  if (revenueRatio !== undefined) settings.revenueRatio = revenueRatio;
  await settings.save();
  res.json({ settings });
};
