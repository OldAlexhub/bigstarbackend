import mongoose from "mongoose";

const immutable = { type: mongoose.Schema.Types.Mixed, required: true, immutable: true };

const eltOutlookSnapshotSchema = new mongoose.Schema(
  {
    reportingLevel: { type: String, enum: ["company", "division"], required: true, immutable: true },
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      default: null,
      immutable: true,
      validate: {
        validator(value) { return this.reportingLevel !== "division" || value != null; },
        message: "Division snapshots require a division.",
      },
    },
    snapshotWeek: { type: Date, required: true, immutable: true },
    dataCutoff: { type: Date, required: true, immutable: true },
    modelVersion: { type: String, required: true, immutable: true },
    metrics: immutable,
    readiness: immutable,
    forecasts: immutable,
    errors: immutable,
    drivers: immutable,
    signals: immutable,
  },
  { timestamps: { createdAt: true, updatedAt: false }, suppressReservedKeysWarning: true }
);

eltOutlookSnapshotSchema.index(
  { reportingLevel: 1, division: 1, snapshotWeek: 1 },
  { unique: true, name: "uniq_elt_outlook_level_division_week" }
);
eltOutlookSnapshotSchema.index({ reportingLevel: 1, division: 1, snapshotWeek: -1 });

const rejectMutation = function rejectMutation() {
  throw new Error("ELT Outlook snapshots are immutable.");
};

eltOutlookSnapshotSchema.pre("updateOne", rejectMutation);
eltOutlookSnapshotSchema.pre("updateMany", rejectMutation);
eltOutlookSnapshotSchema.pre("findOneAndUpdate", rejectMutation);
eltOutlookSnapshotSchema.pre("replaceOne", rejectMutation);
eltOutlookSnapshotSchema.pre("deleteOne", rejectMutation);
eltOutlookSnapshotSchema.pre("deleteMany", rejectMutation);
eltOutlookSnapshotSchema.pre("findOneAndDelete", rejectMutation);

export default mongoose.model("EltOutlookSnapshot", eltOutlookSnapshotSchema);
