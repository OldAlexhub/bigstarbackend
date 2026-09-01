import mongoose from "mongoose";

const dailyKpiEntrySchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    actualHours: {
      type: Number,
      required: true,
      min: 0,
    },
    totalTrips: {
      type: Number,
      required: true,
      min: 0,
    },
    otpPct: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    // The uploaded Daily Tracker row's own closures/late-event counts —
    // null means "never given a tracker value" (imported before this field
    // existed, or entered via the single-row manual endpoints), 0 means
    // "the tracker reported zero." buildTrackerRows.js only falls back to
    // these when Deployment has no coverage at all for that route/date;
    // Deployment stays authoritative whenever it has any record of the day.
    uploadRouteClosures: {
      type: Number,
      default: null,
      min: 0,
    },
    uploadLateToFirst: {
      type: Number,
      default: null,
      min: 0,
    },
    uploadLateDeploy: {
      type: Number,
      default: null,
      min: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

dailyKpiEntrySchema.index({ division: 1, route: 1, date: 1 }, { unique: true });
dailyKpiEntrySchema.index({ division: 1, date: 1 });

const DailyKpiEntry = mongoose.model("DailyKpiEntry", dailyKpiEntrySchema);

export default DailyKpiEntry;
