import mongoose from "mongoose";
import { TIMEZONES, DEFAULT_TIMEZONE } from "../utils/timezone.js";

const divisionSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["standard", "standby"],
      default: "standard",
    },
    // Drives every "today"/"this week" boundary for this division's
    // schedule (RunCutDay generation, Deployment's Today/Tomorrow, Dashboard
    // stats) — see server/utils/timezone.js.
    timezone: {
      type: String,
      enum: TIMEZONES,
      default: DEFAULT_TIMEZONE,
    },
    parentDivision: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
    thresholds: {
      breakMinutes: { type: Number, default: null },
      revenueRatio: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

const Division = mongoose.model("Division", divisionSchema);

export default Division;
