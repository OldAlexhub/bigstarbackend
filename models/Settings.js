import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    breakMinutes: {
      type: Number,
      default: 30,
    },
    revenueRatio: {
      type: Number,
      default: 0.9,
    },
    osrAdvanceDays: {
      type: Number,
      min: 0,
      max: 7,
      validate: {
        validator: Number.isInteger,
        message: "OSR advance days must be a whole number",
      },
      default: 7,
    },
    scheduleHistoryLookbackWeeks: {
      type: Number,
      min: 1,
      max: 12,
      validate: {
        validator: Number.isInteger,
        message: "Schedule History lookback weeks must be a whole number",
      },
      default: 6,
    },
    operationsReportingStartMonth: {
      type: String,
      default: () => new Date().toISOString().slice(0, 7),
    },
  },
  { timestamps: true }
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  } else if (!doc.operationsReportingStartMonth || doc.$isDefault?.("operationsReportingStartMonth")) {
    doc.operationsReportingStartMonth = new Date().toISOString().slice(0, 7);
    await doc.save();
  }
  return doc;
};

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
