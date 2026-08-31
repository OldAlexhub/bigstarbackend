import Operator from "../models/Operator.js";
import Vehicle from "../models/Vehicle.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { normalizeName, normalizeCode, escapeRegex } from "./normalizeText.js";

// Typing an Operator/Vehicle name/code directly on a route (instead of
// picking from a pre-built list) finds the existing record with that name
// (case/whitespace-insensitive, since names get normalized on the way in)
// or creates it on the spot.
export const resolveOperator = async (rawName) => {
  const name = normalizeName(rawName);
  if (!name) return null;
  const existing = await Operator.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, "i") });
  if (existing) return existing._id;
  const created = await Operator.create({ name });
  return created._id;
};

export const resolveVehicle = async (division, rawCode) => {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const existing = await Vehicle.findOne({ division, code: new RegExp(`^${escapeRegex(code)}$`, "i") });
  if (existing) return existing._id;
  const created = await Vehicle.create({ division, code });
  return created._id;
};

export const resolveRoute = async (division, rawCode) => {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const existing = await Route.findOne({ division, code: new RegExp(`^${escapeRegex(code)}$`, "i") });
  if (existing) return existing;
  return Route.create({ division, code });
};

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const timeRangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  let a1 = toMinutes(aStart);
  let a2 = toMinutes(aEnd);
  if (a2 <= a1) a2 += 24 * 60;
  let b1 = toMinutes(bStart);
  let b2 = toMinutes(bEnd);
  if (b2 <= b1) b2 += 24 * 60;
  return a1 < b2 && b1 < a2;
};

// A person can't drive two routes at once — reject an assignment that would
// double-book an operator on an overlapping day and time. Checked across
// every division (operators are company-wide), not just the one being
// edited.
export const findOperatorConflict = async ({ operator, daysOfWeek, startTime, endTime, excludeRunCutId }) => {
  if (!operator || !daysOfWeek?.length || !startTime || !endTime) return null;

  const candidates = await RunCut.find({
    operator,
    _id: { $ne: excludeRunCutId },
    daysOfWeek: { $in: daysOfWeek },
  }).populate("route", "code");

  for (const candidate of candidates) {
    if (timeRangesOverlap(startTime, endTime, candidate.startTime, candidate.endTime)) {
      const overlapDays = daysOfWeek.filter((d) => candidate.daysOfWeek.includes(d));
      return {
        routeCode: candidate.route?.code,
        days: overlapDays,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
      };
    }
  }
  return null;
};

// Same idea as findOperatorConflict, but for a single date rather than a
// recurring weekly pattern — used when Deployment adds a one-off extra duty.
// Checking every other RunCutDay this operator has on this exact date
// covers both their regular scheduled route (already projected onto this
// date) and any other extras, in one query.
export const findOperatorConflictOnDate = async ({ operator, date, startTime, endTime, excludeRunCutDayId }) => {
  if (!operator || !date || !startTime || !endTime) return null;

  const candidates = await RunCutDay.find({
    operator,
    date,
    _id: { $ne: excludeRunCutDayId },
  }).populate("route", "code");

  for (const candidate of candidates) {
    if (timeRangesOverlap(startTime, endTime, candidate.startTime, candidate.endTime)) {
      return { routeCode: candidate.route?.code, startTime: candidate.startTime, endTime: candidate.endTime };
    }
  }
  return null;
};

// The same vehicle covering several routes across a day is completely
// normal (one bus, several shifts) — only worth flagging when two
// assignments actually collide: same vehicle, an overlapping day, and an
// overlapping time. Runs in-memory over a division's already-loaded
// RunCuts rather than hitting the DB again per row.
export const findVehicleConflictIds = (runCuts) => {
  const conflicting = new Set();
  for (let i = 0; i < runCuts.length; i += 1) {
    const a = runCuts[i];
    if (!a.vehicle) continue;
    for (let j = i + 1; j < runCuts.length; j += 1) {
      const b = runCuts[j];
      if (!b.vehicle) continue;
      const sameVehicle = String(a.vehicle._id || a.vehicle) === String(b.vehicle._id || b.vehicle);
      if (!sameVehicle) continue;
      const sharedDay = (a.daysOfWeek || []).some((d) => (b.daysOfWeek || []).includes(d));
      if (!sharedDay) continue;
      if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
        conflicting.add(a._id.toString());
        conflicting.add(b._id.toString());
      }
    }
  }
  return conflicting;
};
