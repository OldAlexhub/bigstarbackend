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
  },
  { timestamps: true }
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
