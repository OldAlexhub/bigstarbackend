// Simple stats behind Weekly Analytics' forecast/outlier/segment cards.
// None of these are rigorous models — they mirror the R app's own
// lightweight implementations (fixed-alpha Holt smoothing, standard MAD
// z-scores, percentile buckets that are NOT actual k-means).

// Holt's linear (trend) exponential smoothing, fixed alpha, projecting
// `periods` steps ahead.
export const holtForecast = (series, periods = 4, alpha = 0.45) => {
  const values = series.filter((v) => Number.isFinite(v));
  if (values.length < 2) return { forecast: [], level: null, trend: null };

  let level = values[0];
  let trend = values[1] - values[0];
  for (let t = 1; t < values.length; t += 1) {
    const prevLevel = level;
    level = alpha * values[t] + (1 - alpha) * (level + trend);
    trend = alpha * (level - prevLevel) + (1 - alpha) * trend;
  }

  const forecast = [];
  for (let h = 1; h <= periods; h += 1) {
    forecast.push(Math.round((level + h * trend) * 100) / 100);
  }
  return { forecast, level: Math.round(level * 100) / 100, trend: Math.round(trend * 100) / 100 };
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Modified z-scores (Median Absolute Deviation), flags entries more than
// 2.5 MAD below the median as at-risk outliers.
export const madScores = (entries, valueFn, threshold = -2.5) => {
  const values = entries.map(valueFn).filter((v) => Number.isFinite(v));
  if (!values.length) return entries.map((e) => ({ ...e, madScore: null, isOutlier: false }));

  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;

  return entries.map((entry) => {
    const value = valueFn(entry);
    if (!Number.isFinite(value) || mad === 0) {
      return { ...entry, madScore: null, isOutlier: false };
    }
    const score = (value - med) / mad;
    return { ...entry, madScore: Math.round(score * 100) / 100, isOutlier: score < threshold };
  });
};

// Percentile-bucket "segments" (top 25% / bottom 30% / middle) — not real
// k-means, matching the R app's own comment on segment_rankings().
export const segmentRankings = (entries, valueFn) => {
  const sorted = [...entries].sort((a, b) => valueFn(b) - valueFn(a));
  const n = sorted.length;
  const eliteCount = Math.ceil(n * 0.25);
  const atRiskCount = Math.ceil(n * 0.3);

  return sorted.map((entry, i) => {
    let segment = "Standard";
    if (i < eliteCount) segment = "Elite";
    else if (i >= n - atRiskCount) segment = "At-Risk";
    return { ...entry, segment };
  });
};
