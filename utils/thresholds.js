import Settings from "../models/Settings.js";

export const getEffectiveThresholds = async (division) => {
  const settings = await Settings.getSingleton();
  return {
    breakMinutes: division?.thresholds?.breakMinutes ?? settings.breakMinutes,
    revenueRatio: division?.thresholds?.revenueRatio ?? settings.revenueRatio,
  };
};
