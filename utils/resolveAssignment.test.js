import test from "node:test";
import assert from "node:assert/strict";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import {
  findVehicleConflict,
  findVehicleConflictOnDate,
  recurringOverlapDays,
  timeRangesOverlap,
} from "./resolveAssignment.js";

test("time overlap allows back-to-back duties and detects real collisions", () => {
  assert.equal(timeRangesOverlap("08:00", "12:00", "12:00", "16:00"), false);
  assert.equal(timeRangesOverlap("08:00", "12:01", "12:00", "16:00"), true);
  assert.equal(timeRangesOverlap("22:00", "02:00", "23:00", "01:00"), true);
});

test("recurring overlap detects an overnight duty colliding with the next service day", () => {
  assert.deepEqual(
    recurringOverlapDays(["MON"], "23:00", "02:00", ["TUE"], "01:00", "03:00"),
    ["MON"]
  );
  assert.deepEqual(
    recurringOverlapDays(["MON"], "23:00", "01:00", ["TUE"], "01:00", "03:00"),
    []
  );
});

test("Master Run Cuts rejects an overlapping vehicle assignment", async () => {
  const originalFind = RunCut.find;
  RunCut.find = () => ({
    populate: async () => [{
      route: { code: "R-2" },
      daysOfWeek: ["MON", "TUE"],
      startTime: "09:00",
      endTime: "13:00",
    }],
  });

  try {
    const conflict = await findVehicleConflict({
      vehicle: "vehicle-1",
      daysOfWeek: ["MON"],
      startTime: "08:00",
      endTime: "10:00",
    });
    assert.deepEqual(conflict, {
      routeCode: "R-2",
      days: ["MON"],
      startTime: "09:00",
      endTime: "13:00",
    });
  } finally {
    RunCut.find = originalFind;
  }
});

test("Deployment rejects an overlapping vehicle assignment on the same date", async () => {
  const originalFind = RunCutDay.find;
  RunCutDay.find = () => ({
    populate: async () => [{
      route: { code: "LIVE-2" },
      date: new Date("2026-09-15"),
      startTime: "10:00",
      endTime: "14:00",
    }],
  });

  try {
    const conflict = await findVehicleConflictOnDate({
      vehicle: "vehicle-1",
      date: new Date("2026-09-15"),
      startTime: "12:00",
      endTime: "16:00",
    });
    assert.equal(conflict.routeCode, "LIVE-2");
  } finally {
    RunCutDay.find = originalFind;
  }
});
