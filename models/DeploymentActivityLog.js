import mongoose from "mongoose";

// One row per action taken in Deployment (Live Schedule / Issue Log) — an
// append-only trail so a deleted extra run or a deleted issue still leaves a
// trace of who did it and when, which the underlying doc alone can't
// provide once it's gone. username/name are snapshotted at write time so the
// log stays readable even if the user's account is later renamed.
const deploymentActivityLogSchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    username: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    action: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

deploymentActivityLogSchema.index({ division: 1, createdAt: -1 });

const DeploymentActivityLog = mongoose.model("DeploymentActivityLog", deploymentActivityLogSchema);

export default DeploymentActivityLog;
