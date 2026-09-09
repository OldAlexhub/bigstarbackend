import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED_SUSPENDED_DISPOSITION,
  syncDispositionWithStatus,
} from "./dispositions.js";

test("a suspended status automatically owns the Closed/Suspended disposition", () => {
  const runCutDay = {
    disposition: "deployed_late",
    dispositionSource: "manual",
    dispositionStandbyDay: "standby-day-id",
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "suspended"), true);
  assert.equal(runCutDay.disposition, CLOSED_SUSPENDED_DISPOSITION);
  assert.equal(runCutDay.dispositionSource, "status");
  assert.equal(runCutDay.dispositionStandbyDay, null);
});

test("moving away from suspended clears only a status-owned disposition", () => {
  const runCutDay = {
    disposition: CLOSED_SUSPENDED_DISPOSITION,
    dispositionSource: "status",
    dispositionStandbyDay: null,
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "active"), true);
  assert.equal(runCutDay.disposition, null);
  assert.equal(runCutDay.dispositionSource, null);
  assert.equal(runCutDay.dispositionStandbyDay, null);
});

test("a non-suspended status preserves a manually selected disposition", () => {
  const runCutDay = {
    disposition: "deployed_on_time",
    dispositionSource: "manual",
    dispositionStandbyDay: null,
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "active"), false);
  assert.equal(runCutDay.disposition, "deployed_on_time");
  assert.equal(runCutDay.dispositionSource, "manual");
});
