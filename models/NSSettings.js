import mongoose from "mongoose";

const nsSettingsSchema = new mongoose.Schema(
  {
    otpThresh: { type: Number, default: 0.9 },
    shfThresh: { type: Number, default: 0.95 },
    tpshBench: { type: Number, default: 1.25 },
    routeClosureBench: { type: Number, default: 0 },
    lateFirstBench: { type: Number, default: 0 },
    lateDeployBench: { type: Number, default: 0 },
    scoreCap: { type: Number, default: 1 },
    revenueHourDeduction: { type: Number, default: 0.5 },
    revenueHourMultiplier: { type: Number, default: 0.9 },
    weights: {
      otp: { type: Number, default: 0.33 },
      shf: { type: Number, default: 0.32 },
      tpsh: { type: Number, default: 0.2 },
      routeClosure: { type: Number, default: 0.05 },
      lateFirst: { type: Number, default: 0.05 },
      lateDeploy: { type: Number, default: 0.05 },
    },
  },
  { timestamps: true }
);

nsSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

const NSSettings = mongoose.model("NSSettings", nsSettingsSchema);

export default NSSettings;
