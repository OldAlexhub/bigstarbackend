import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import EltOutlookSnapshot from "./EltOutlookSnapshot.js";

const record = (extra = {}) => ({
  reportingLevel: "company",
  division: null,
  snapshotWeek: new Date("2026-09-06T00:00:00.000Z"),
  dataCutoff: new Date("2026-09-12T00:00:00.000Z"),
  modelVersion: "elt-outlook-v1",
  metrics: [],
  readiness: {},
  forecasts: {},
  errors: {},
  drivers: {},
  signals: [],
  ...extra,
});

test("outlook snapshots have one immutable record per reporting level, division, and week", () => {
  const index = EltOutlookSnapshot.schema.indexes().find(([, options]) => options.name === "uniq_elt_outlook_level_division_week");
  assert.ok(index);
  assert.deepEqual(index[0], { reportingLevel: 1, division: 1, snapshotWeek: 1 });
  assert.equal(index[1].unique, true);
  assert.equal(EltOutlookSnapshot.schema.path("dataCutoff").options.immutable, true);
  assert.equal(EltOutlookSnapshot.schema.path("forecasts").options.immutable, true);
});

test("division snapshot validation requires its division", async () => {
  await assert.rejects(new EltOutlookSnapshot(record({ reportingLevel: "division" })).validate(), /require a division/i);
  await new EltOutlookSnapshot(record({ reportingLevel: "division", division: new mongoose.Types.ObjectId() })).validate();
});
