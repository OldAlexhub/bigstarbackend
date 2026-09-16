import assert from "node:assert/strict";
import test from "node:test";
import {
  activateRouteWithStandbyCoverage,
  CLOSED_SUSPENDED_DISPOSITION,
  removeStandbyCoverageFromRoute,
  syncDispositionWithStatus,
  syncStatusWithDisposition,
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

test("selecting Closed/Suspended automatically sets and owns the Suspended status", () => {
  const runCutDay = {
    status: "active",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
  };

  assert.equal(
    syncStatusWithDisposition(runCutDay, CLOSED_SUSPENDED_DISPOSITION),
    true
  );
  assert.equal(runCutDay.status, "suspended");
  assert.equal(runCutDay.disposition, CLOSED_SUSPENDED_DISPOSITION);
  assert.equal(runCutDay.dispositionSource, "status");
});

test("other disposition selections do not change the route status", () => {
  const runCutDay = { status: "active" };

  assert.equal(syncStatusWithDisposition(runCutDay, "deployed_late"), false);
  assert.equal(runCutDay.status, "active");
});

test("standby coverage activates the covered route and owns its disposition", () => {
  const runCutDay = {
    status: "suspended",
    disposition: CLOSED_SUSPENDED_DISPOSITION,
    dispositionSource: "status",
    dispositionStandbyDay: null,
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id");

  assert.equal(runCutDay.status, "active");
  assert.equal(runCutDay.disposition, "deployed_stby");
  assert.equal(runCutDay.dispositionSource, "standby");
  assert.equal(runCutDay.dispositionStandbyDay, "standby-day-id");
});

test("standby coverage carries its pullout address to the covered route and restores the prior value", () => {
  const runCutDay = {
    status: "active",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
    pulloutAddress: "Original Garage",
    pulloutAddressStandbyDay: null,
    pulloutAddressBeforeStandby: "",
    pulloutAddressOverrideBeforeStandby: false,
    overrides: { pulloutAddress: false },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", "Standby Depot");

  assert.equal(runCutDay.pulloutAddress, "Standby Depot");
  assert.equal(runCutDay.pulloutAddressStandbyDay, "standby-day-id");
  assert.equal(runCutDay.pulloutAddressBeforeStandby, "Original Garage");
  assert.equal(runCutDay.overrides.pulloutAddress, true);

  assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true);
  assert.equal(runCutDay.pulloutAddress, "Original Garage");
  assert.equal(runCutDay.pulloutAddressStandbyDay, null);
  assert.equal(runCutDay.overrides.pulloutAddress, false);
});

test("refreshing the same standby coverage does not replace the original pullout snapshot", () => {
  const runCutDay = {
    pulloutAddress: "Original Garage",
    pulloutAddressStandbyDay: null,
    pulloutAddressBeforeStandby: "",
    pulloutAddressOverrideBeforeStandby: true,
    overrides: { pulloutAddress: true },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", "First Standby Depot");
  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", "Updated Standby Depot");

  assert.equal(runCutDay.pulloutAddress, "Updated Standby Depot");
  assert.equal(runCutDay.pulloutAddressBeforeStandby, "Original Garage");
  removeStandbyCoverageFromRoute(runCutDay, "standby-day-id");
  assert.equal(runCutDay.pulloutAddress, "Original Garage");
  assert.equal(runCutDay.overrides.pulloutAddress, true);
});
