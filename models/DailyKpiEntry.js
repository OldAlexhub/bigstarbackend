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
