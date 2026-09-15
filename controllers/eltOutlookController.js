import mongoose from "mongoose";
import Division from "../models/Division.js";
import { todayInTimezone } from "../utils/timezone.js";
import { addDays } from "../utils/weeklyMetrics.js";
import {
  computeEltOutlook,
  latestOutlookSnapshot,
  selectOfficialForecast,
} from "../services/eltOutlookService.js";

export const getEltOutlook = async (req, res) => {
  const horizon = req.query.horizon || "90d";
  if (!new Set(["90d", "12m"]).has(horizon)) {
    return res.status(400).json({ message: "horizon must be 90d or 12m" });
  }

  const divisionId = req.query.division || null;
  if (divisionId && !mongoose.isValidObjectId(divisionId)) {
    return res.status(400).json({ message: "division must be a valid division id" });
  }

  const filter = { active: true };
  if (divisionId) filter._id = divisionId;
  const divisions = await Division.find(filter).sort({ code: 1 });
  if (divisionId && !divisions.length) return res.status(404).json({ message: "Division not found" });
  if (!divisions.length) return res.status(404).json({ message: "No active divisions are available" });

  // Company outlook uses the Eastern business-calendar cutoff; a single
  // division uses that division's own local calendar. In both cases the
  // rolling window ends yesterday, never on a partially completed today.
  const timezone = divisions.length === 1 ? divisions[0].timezone : "America/New_York";
  const cutoff = addDays(todayInTimezone(timezone), -1);
  const [live, snapshot] = await Promise.all([
    computeEltOutlook({ divisions, cutoff, reportingLevel: divisionId ? "division" : "company" }),
    latestOutlookSnapshot({ division: divisionId }),
  ]);
  return res.json(selectOfficialForecast(live, snapshot, horizon));
};
