import assert from "node:assert/strict";
import test from "node:test";
import { outlookMonthOf, selectOfficialForecast } from "./eltOutlookService.js";

const live = {
  dataCutoff: "2026-09-14",
  modelVersion: "elt-outlook-v1",
  metrics: [{
    key: "completedTrips",
    value: 120,
    forecasts: {
      "90d": { ready: true, reasons: [], points: [{ period: "2026-09-20", value: 125 }] },
    },
  }],
};

test("outlook month normalization accepts both stored strings and job Date values", () => {
  assert.equal(outlookMonthOf("2026-09-14"), "2026-09");
  assert.equal(outlookMonthOf(new Date("2026-09-14T00:00:00.000Z")), "2026-09");
});

test("a stale snapshot never replaces fresh current state with an official forecast", () => {
  const response = selectOfficialForecast(live, {
    snapshotWeek: new Date("2026-08-23T00:00:00.000Z"),
    dataCutoff: new Date("2026-08-29T00:00:00.000Z"),
    modelVersion: "elt-outlook-v1",
    forecasts: { completedTrips: { "90d": { ready: true, points: [{ period: "2026-09-20", value: 999 }] } } },
  }, "90d");

  assert.equal(response.metrics[0].value, 120);
  assert.equal(response.metrics[0].forecast.ready, false);
  assert.equal(response.metrics[0].forecast.points.length, 0);
  assert.equal(response.snapshot.stale, true);
  assert.ok(response.metrics[0].forecast.reasons.some((reason) => reason.code === "stale_snapshot"));
});

test("a current weekly snapshot supplies the official forecast bands", () => {
  const official = { ready: true, model: "damped_holt", points: [{ period: "2026-09-20", value: 125, lower80: 115, upper80: 135 }] };
  const response = selectOfficialForecast(live, {
    snapshotWeek: new Date("2026-09-06T00:00:00.000Z"),
    dataCutoff: new Date("2026-09-12T00:00:00.000Z"),
    modelVersion: "elt-outlook-v1",
    forecasts: { completedTrips: { "90d": official } },
  }, "90d");

  assert.deepEqual(response.metrics[0].forecast, official);
  assert.equal(response.snapshot.stale, false);
});
