import assert from "node:assert/strict";
import test from "node:test";
import RunCutDay from "../models/RunCutDay.js";
import { restoreCoverageOwnedByStandbyDays } from "./standbyCoveragePersistence.js";

test("deleting a standby day restores the pullout address on its covered route", async () => {
  const originalFind = RunCutDay.find;
  let saved = false;
  const coveredDay = {
    disposition: "deployed_stby",
    dispositionSource: "standby",
    dispositionStandbyDay: "standby-day-1",
    pulloutAddress: "Standby Depot",
    pulloutAddressStandbyDay: "standby-day-1",
    pulloutAddressBeforeStandby: "Route Garage",
    pulloutAddressOverrideBeforeStandby: false,
    overrides: { pulloutAddress: true },
    async save() { saved = true; },
  };
  RunCutDay.find = async () => [coveredDay];

  try {
    await restoreCoverageOwnedByStandbyDays(["standby-day-1"], "user-1");
    assert.equal(saved, true);
    assert.equal(coveredDay.pulloutAddress, "Route Garage");
    assert.equal(coveredDay.pulloutAddressStandbyDay, null);
    assert.equal(coveredDay.overrides.pulloutAddress, false);
    assert.equal(coveredDay.disposition, null);
    assert.equal(coveredDay.updatedBy, "user-1");
  } finally {
    RunCutDay.find = originalFind;
  }
});
