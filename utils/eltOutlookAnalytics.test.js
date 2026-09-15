import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateWeightedResults,
  deriveOutlookSignals,
  evaluateForecast,
  metricDefinition,
  robustDirection,
} from "./eltOutlookAnalytics.js";

const weekly = (values) => values.map((value, index) => ({
  period: new Date(Date.UTC(2025, 0, 5 + index * 7)).toISOString().slice(0, 10),
  value,
}));

test("company ratios are denominator-weighted and missing cohorts are not treated as zero", () => {
  const result = aggregateWeightedResults([
    { numerator: 9, denominator: 10 },
    { numerator: 45, denominator: 90 },
    { numerator: null, denominator: null },
  ]);
  assert.equal(result.value, 0.54);
  assert.equal(result.matched, 2);

  const unavailable = aggregateWeightedResults([{ numerator: null, denominator: null }]);
  assert.equal(unavailable.value, null);
});

test("weekly direction requires coverage and detects a material robust improvement", () => {
  const definition = metricDefinition("runCutFulfillment");
  const improving = robustDirection(weekly([0.9, 0.903, 0.907, 0.91, 0.913, 0.917, 0.92, 0.923, 0.927, 0.93]), definition, 13);
  assert.equal(improving.direction, "improving");
  assert.equal(improving.confidence, "medium");

  const sparse = robustDirection(weekly([0.9, null, 0.91, null, 0.92, null, 0.93]), definition, 13);
  assert.equal(sparse.direction, "not_enough_data");
  assert.match(sparse.reason, /8 complete observations/);
});

test("forecast readiness selects a backtested candidate and returns 13 bounded weekly points", () => {
  const values = Array.from({ length: 32 }, (_, index) => 0.65 + index * 0.006);
  const forecast = evaluateForecast(weekly(values), metricDefinition("runCutFulfillment"), "90d");
  assert.equal(forecast.ready, true);
  assert.notEqual(forecast.model, "naive");
  assert.equal(forecast.points.length, 13);
  assert.ok(forecast.points.every((point) => point.lower80 >= 0 && point.upper80 <= 1));
});

test("forecast gates return exact readiness reasons for sparse history", () => {
  const values = Array.from({ length: 30 }, (_, index) => index % 2 ? null : 100 + index);
  const forecast = evaluateForecast(weekly(values), metricDefinition("completedTrips"), "90d");
  assert.equal(forecast.ready, false);
  assert.ok(forecast.reasons.some((reason) => reason.code === "insufficient_history"));
  assert.ok(forecast.reasons.some((reason) => reason.code === "insufficient_coverage"));
  assert.equal(forecast.points.length, 0);
});

test("the efficient-but-fragile signal is deterministic at the specified thresholds", () => {
  const signals = deriveOutlookSignals([
    { key: "runCutFulfillment", value: 0.92 },
    { key: "actualRevenueHourFulfillment", value: 1.05 },
  ]);
  assert.ok(signals.some((signal) => signal.key === "efficient_but_fragile"));
});
