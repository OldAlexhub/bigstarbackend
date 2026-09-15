const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const OUTLOOK_MODEL_VERSION = "elt-outlook-v1";

export const OUTLOOK_METRICS = [
  { key: "runCutFulfillment", label: "Run Cut Fulfillment", group: "Fulfillment", format: "percent", targetKey: "run_cut_fulfillment", higherIsBetter: true },
  { key: "plannedRevenueHourFulfillment", label: "Planned Revenue Hour Fulfillment", group: "Fulfillment", format: "percent", targetKey: "core_revenue_fulfillment", higherIsBetter: true },
  { key: "actualRevenueHourFulfillment", label: "Actual Revenue Hour Fulfillment", group: "Fulfillment", format: "percent", targetKey: "core_revenue_fulfillment", higherIsBetter: true },
  { key: "revenueHoursAtRisk", label: "Revenue Hours at Risk", group: "Fulfillment", format: "hours", higherIsBetter: false },
  { key: "completedTrips", label: "Completed Trips", group: "Productivity", format: "number", higherIsBetter: true },
  { key: "tripsPerOperatingDay", label: "Trips per Operating Day", group: "Productivity", format: "ratio", higherIsBetter: true },
  { key: "tpsh", label: "Trips per Service Hour", group: "Productivity", format: "ratio", targetKey: "tpsh", higherIsBetter: true },
  { key: "otp", label: "On-Time Performance", group: "Reliability", format: "percent", targetKey: "otp", higherIsBetter: true },
  { key: "goLinkOtp", label: "GO LINK On-Time Performance", group: "Reliability", format: "percent", targetKey: "go_link_otp", higherIsBetter: true },
  { key: "standbyUtilization", label: "Standby Utilization", group: "Capacity", format: "percent", targetKey: "standby_utilization", higherIsBetter: true },
  { key: "closures", label: "Closures", group: "Reliability", format: "event", higherIsBetter: false },
  { key: "lateToFirst", label: "Late to First", group: "Reliability", format: "event", higherIsBetter: false },
  { key: "lateDeploy", label: "Late Deploy", group: "Reliability", format: "event", higherIsBetter: false },
  { key: "safetyScore", label: "Safety Score", group: "Safety", format: "number", targetKey: "safety_score", higherIsBetter: true, monthly: true },
  { key: "preventableAccidentRatio", label: "Preventable Accident Ratio", group: "Safety", format: "ratio", targetKey: "preventable_accident_ratio", higherIsBetter: false, monthly: true },
  { key: "complaintRatio", label: "Complaint Ratio", group: "Customer Service", format: "ratio", targetKey: "complaint_ratio", higherIsBetter: false, monthly: true },
];

export const metricDefinition = (key) => OUTLOOK_METRICS.find((metric) => metric.key === key);

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantile = (values, probability) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + remainder * (sorted[lower + 1] - sorted[lower]);
};

export const robustDirection = (observations, definition, expectedPeriods = observations.length) => {
  const complete = observations
    .map((observation, index) => ({ ...observation, index, value: finite(observation.value) }))
    .filter((observation) => observation.value !== null && observation.complete !== false);
  const coverage = expectedPeriods > 0 ? complete.length / expectedPeriods : 0;
  const base = { observations: complete.length, expectedObservations: expectedPeriods, coverage: round(coverage), confidence: "low" };
  if (complete.length < 8) {
    return { ...base, direction: "not_enough_data", reason: `Need at least 8 complete observations; ${complete.length} available.` };
  }
  if (coverage < 0.7) {
    return { ...base, direction: "not_enough_data", reason: `Coverage is ${Math.round(coverage * 100)}%; at least 70% is required.` };
  }

  const slopes = [];
  for (let i = 0; i < complete.length; i += 1) {
    for (let j = i + 1; j < complete.length; j += 1) {
      const span = complete[j].index - complete[i].index;
      if (span > 0) slopes.push((complete[j].value - complete[i].value) / span);
    }
  }
  const slope = median(slopes) || 0;
  const span = Math.max(1, complete.at(-1).index - complete[0].index);
  const change = slope * span;
  const baseline = Math.max(Math.abs(median(complete.map((observation) => observation.value)) || 0), 0.000001);
  let material = false;
  if (definition.format === "percent") material = Math.abs(change) >= 0.02;
  else if (definition.format === "event") material = Math.abs(slope) >= Math.max(baseline * 0.2, 1);
  else material = Math.abs(change) >= baseline * 0.05;

  let direction = "steady";
  if (material && change !== 0) {
    const rising = change > 0;
    direction = rising === definition.higherIsBetter ? "improving" : "declining";
  }
  return {
    ...base,
    direction,
    reason: material ? null : "Change is below the materiality threshold.",
    slope: round(slope, 6),
    estimatedChange: round(change, 6),
    confidence: coverage >= 0.9 && complete.length >= 12 ? "high" : "medium",
  };
};

const naiveForecast = (values) => values.at(-1);
const movingAverageForecast = (values, window = 4) => {
  const sample = values.slice(-Math.min(window, values.length));
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
};

const holtState = (values, alpha, beta, phi) => {
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;
  let squaredError = 0;
  for (let index = 1; index < values.length; index += 1) {
    const predicted = level + phi * trend;
    squaredError += (values[index] - predicted) ** 2;
    const previousLevel = level;
    level = alpha * values[index] + (1 - alpha) * predicted;
    trend = beta * (level - previousLevel) + (1 - beta) * phi * trend;
  }
  return { level, trend, squaredError };
};

const fitDampedHolt = (values) => {
  let best = null;
  for (const alpha of [0.2, 0.4, 0.6, 0.8]) {
    for (const beta of [0.1, 0.2, 0.4]) {
      for (const phi of [0.8, 0.9, 0.98]) {
        const state = holtState(values, alpha, beta, phi);
        if (!best || state.squaredError < best.squaredError) best = { ...state, alpha, beta, phi };
      }
    }
  }
  return best;
};

const holtForecast = (values, step = 1) => {
  const state = fitDampedHolt(values);
  const damped = Array.from({ length: step }, (_, index) => state.phi ** (index + 1)).reduce((sum, value) => sum + value, 0);
  return state.level + damped * state.trend;
};

const errorScore = (actual, predicted, percentage) => {
  if (!actual.length) return null;
  if (percentage) return actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length;
  const denominator = actual.reduce((sum, value) => sum + Math.abs(value), 0);
  const absoluteError = actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0);
  return denominator > 0
    ? absoluteError / denominator
    : absoluteError === 0 ? 0 : null;
};

const modelPrediction = (name, training, definition) => {
  if (name === "naive") return naiveForecast(training);
  if (name === "seasonal_naive") return training.length >= 12 ? training.at(-12) : null;
  if (name === "damped_holt") return holtForecast(training);
  if (name === "empirical_rate") return movingAverageForecast(training, 13);
  return movingAverageForecast(training, definition.monthly ? 3 : 4);
};

const clampForecast = (value, definition) => {
  let result = Math.max(0, value);
  if (definition.format === "percent" && definition.key !== "actualRevenueHourFulfillment") result = Math.min(1, result);
  return round(result);
};

const addPeriod = (period, amount, monthly) => {
  const date = new Date(`${String(period).slice(0, 10)}T00:00:00.000Z`);
  if (monthly) date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCDate(date.getUTCDate() + amount * 7);
  return monthly ? date.toISOString().slice(0, 7) : date.toISOString().slice(0, 10);
};

const readinessReason = (code, message) => ({ code, message });

export const evaluateForecast = (observations, definition, horizon = "90d") => {
  const monthly = horizon === "12m";
  const requiredHistory = monthly ? 24 : 26;
  const requiredCoverage = monthly ? 0.9 : 0.8;
  const requiredBacktests = monthly ? 6 : 8;
  const periodsAhead = monthly ? 12 : 13;
  const percentage = definition.format === "percent";
  const threshold = percentage ? (monthly ? 0.05 : 0.03) : 0.15;
  // Coverage begins with the first real observation. Time before a source
  // was introduced is unavailable history, not a run of missing reports;
  // gaps after that first observation do count against readiness.
  const firstObserved = observations.findIndex((observation) => finite(observation.value) !== null);
  const effectiveObservations = firstObserved >= 0 ? observations.slice(firstObserved) : observations;
  const complete = effectiveObservations.filter((observation) => finite(observation.value) !== null);
  const values = complete.map((observation) => finite(observation.value));
  const coverage = effectiveObservations.length ? complete.length / effectiveObservations.length : 0;
  const reasons = [];

  if (values.length < requiredHistory) {
    reasons.push(readinessReason("insufficient_history", `Need ${requiredHistory} observed ${monthly ? "months" : "weeks"}; ${values.length} available.`));
  }
  if (coverage < requiredCoverage) {
    reasons.push(readinessReason("insufficient_coverage", `Coverage is ${Math.round(coverage * 100)}%; at least ${Math.round(requiredCoverage * 100)}% is required.`));
  }

  const sparseEvents = definition.format === "event" && values.filter((value) => value > 0).length / Math.max(1, values.length) < 0.35;
  const baselineName = monthly ? "seasonal_naive" : "naive";
  const candidates = sparseEvents ? ["empirical_rate", "damped_holt"] : ["moving_average", "damped_holt"];
  const actualByModel = new Map([[baselineName, []], ...candidates.map((name) => [name, []])]);
  const predictedByModel = new Map([[baselineName, []], ...candidates.map((name) => [name, []])]);
  const minimumTraining = monthly ? 12 : 8;

  for (let origin = minimumTraining; origin < values.length; origin += 1) {
    const training = values.slice(0, origin);
    for (const name of [baselineName, ...candidates]) {
      const prediction = modelPrediction(name, training, definition);
      if (!Number.isFinite(prediction)) continue;
      actualByModel.get(name).push(values[origin]);
      predictedByModel.get(name).push(prediction);
    }
  }

  const evaluations = [baselineName, ...candidates].map((name) => ({
    model: name,
    backtests: actualByModel.get(name).length,
    error: errorScore(actualByModel.get(name), predictedByModel.get(name), percentage),
  }));
  const baseline = evaluations.find((evaluation) => evaluation.model === baselineName);
  const viable = evaluations
    .filter((evaluation) => evaluation.model !== baselineName && evaluation.backtests >= requiredBacktests && Number.isFinite(evaluation.error))
    .sort((a, b) => a.error - b.error);
  const best = viable[0] || null;

  if (!best || best.backtests < requiredBacktests) {
    reasons.push(readinessReason("insufficient_backtests", `Need ${requiredBacktests} rolling-origin backtests; ${best?.backtests || 0} available.`));
  }
  const improvement = best && Number.isFinite(baseline?.error) && baseline.error > 0
    ? (baseline.error - best.error) / baseline.error
    : null;
  if (best && !(improvement >= 0.05)) {
    reasons.push(readinessReason("no_naive_improvement", `Best candidate did not improve on ${monthly ? "seasonal naive" : "naive"} by at least 5%.`));
  }
  if (best && best.error > threshold) {
    reasons.push(readinessReason("error_above_threshold", `${percentage ? "MAE" : "WAPE"} is ${round(best.error, 4)}; the maximum is ${threshold}.`));
  }

  const ready = reasons.length === 0;
  const residuals = best
    ? actualByModel.get(best.model).map((value, index) => Math.abs(value - predictedByModel.get(best.model)[index]))
    : [];
  const band = quantile(residuals, 0.9);
  const lastPeriod = effectiveObservations.at(-1)?.period || complete.at(-1)?.period ||
    (monthly ? new Date().toISOString().slice(0, 7) : new Date().toISOString().slice(0, 10));
  const points = ready ? Array.from({ length: periodsAhead }, (_, index) => {
    const raw = best.model === "damped_holt"
      ? holtForecast(values, index + 1)
      : modelPrediction(best.model, values, definition);
    return {
      period: addPeriod(lastPeriod, index + 1, monthly),
      value: clampForecast(raw, definition),
      lower80: clampForecast(raw - band, definition),
      upper80: clampForecast(raw + band, definition),
    };
  }) : [];

  return {
    ready,
    horizon,
    historyObserved: values.length,
    historyExpected: effectiveObservations.length,
    coverage: round(coverage),
    model: ready ? best.model : null,
    errorType: percentage ? "MAE" : "WAPE",
    error: best ? round(best.error, 6) : null,
    baselineModel: baselineName,
    baselineError: Number.isFinite(baseline?.error) ? round(baseline.error, 6) : null,
    improvementVsBaseline: round(improvement, 6),
    backtests: best?.backtests || 0,
    reasons,
    points,
  };
};

const metricValue = (metrics, key) => metrics.find((metric) => metric.key === key)?.value;
const metricDirection = (metrics, key) => metrics.find((metric) => metric.key === key)?.direction?.direction;
const below = (value, target) => Number.isFinite(value) && Number.isFinite(target) && value < target;
const above = (value, target) => Number.isFinite(value) && Number.isFinite(target) && value > target;

export const deriveOutlookSignals = (metrics) => {
  const signals = [];
  const runCut = metricValue(metrics, "runCutFulfillment");
  const actualRevenue = metricValue(metrics, "actualRevenueHourFulfillment");
  if (runCut >= 0.92 && actualRevenue >= 1.05) {
    signals.push({ key: "efficient_but_fragile", severity: "watch", label: "Efficient but fragile", explanation: "Actual revenue delivery is above plan while run-cut fulfillment leaves limited operating cushion." });
  }

  if (metricDirection(metrics, "completedTrips") === "improving") {
    signals.push({ key: "demand_growth", severity: "positive", label: "Demand growth", explanation: "Completed-trip volume is rising materially across the observed weekly series." });
  }
  if (metricDirection(metrics, "completedTrips") === "improving" && ["declining"].includes(metricDirection(metrics, "runCutFulfillment"))) {
    signals.push({ key: "capacity_pressure", severity: "watch", label: "Capacity pressure", explanation: "Trip demand is increasing while run-cut fulfillment is deteriorating." });
  }

  const standby = metrics.find((metric) => metric.key === "standbyUtilization");
  const tpsh = metrics.find((metric) => metric.key === "tpsh");
  if (below(standby?.value, standby?.target) || below(tpsh?.value, tpsh?.target)) {
    signals.push({ key: "underutilization", severity: "watch", label: "Underutilization", explanation: "A capacity productivity indicator is below its configured operating target." });
  }

  const planned = metrics.find((metric) => metric.key === "plannedRevenueHourFulfillment");
  const actual = metrics.find((metric) => metric.key === "actualRevenueHourFulfillment");
  if (planned?.value >= (planned?.target ?? 0.95) && below(actual?.value, actual?.target ?? 0.95)) {
    signals.push({ key: "execution_gap", severity: "risk", label: "Execution gap", explanation: "Planned revenue coverage is on target, but matched actual revenue delivery is below target." });
  }

  if (["otp", "goLinkOtp"].some((key) => metricDirection(metrics, key) === "declining") ||
      ["closures", "lateToFirst", "lateDeploy"].some((key) => metricDirection(metrics, key) === "declining")) {
    signals.push({ key: "reliability_deterioration", severity: "risk", label: "Reliability deterioration", explanation: "One or more service-reliability indicators are worsening materially." });
  }

  const safetyScore = metrics.find((metric) => metric.key === "safetyScore");
  const preventable = metrics.find((metric) => metric.key === "preventableAccidentRatio");
  if (below(safetyScore?.value, safetyScore?.target) || above(preventable?.value, preventable?.target)) {
    signals.push({ key: "safety_risk", severity: "risk", label: "Safety risk", explanation: "A safety indicator is outside its configured threshold." });
  }
  const complaint = metrics.find((metric) => metric.key === "complaintRatio");
  if (above(complaint?.value, complaint?.target)) {
    signals.push({ key: "customer_service_risk", severity: "risk", label: "Customer-service risk", explanation: "Complaints per 1,000 completed trips are above target." });
  }
  return signals;
};

export const weightedValue = (numerator, denominator, scale = 1) =>
  Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? round((numerator / denominator) * scale, 6)
    : null;

export const aggregateWeightedResults = (results, scale = 1) => {
  const matched = results.filter((result) => Number.isFinite(result?.numerator) && Number.isFinite(result?.denominator) && result.denominator > 0);
  if (!matched.length) return { value: null, numerator: null, denominator: null, matched: 0 };
  const numerator = matched.reduce((sum, result) => sum + result.numerator, 0);
  const denominator = matched.reduce((sum, result) => sum + result.denominator, 0);
  return { value: weightedValue(numerator, denominator, scale), numerator, denominator, matched: matched.length };
};

export const average = (values) => {
  const available = values.map(finite).filter((value) => value !== null);
  return available.length ? round(available.reduce((sum, value) => sum + value, 0) / available.length, 6) : null;
};
