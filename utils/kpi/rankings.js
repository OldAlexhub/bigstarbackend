const safeMean = (values) => {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Port of calculations.R's route_daily_data(): a row is "closure-only" when a
// closure was logged but no service was actually operated that day — it
// still counts toward the closure total but is excluded from OTP/SHF/TPSH.
export const routeDailyData = (rows) =>
  rows.map((row) => {
    const isClosureOnly = row.routeClosures > 0 && row.actualHrs <= 0 && row.totalTrips <= 0;
    return {
      ...row,
      isClosureOnly,
      shf: !isClosureOnly && row.schedHrs > 0 ? row.actualHrs / row.schedHrs : null,
      tpsh: !isClosureOnly && row.actualHrs > 0 ? row.totalTrips / row.actualHrs : null,
      otp: isClosureOnly ? null : row.otpPct,
    };
  });

const scoreHigherIsBetter = (avg, threshold, cap) => {
  if (avg == null || !Number.isFinite(avg) || !threshold) return null;
  return Math.min(avg / threshold, cap);
};

const scoreLowerIsBetter = (avgPerDay, benchmark, cap) => {
  if (avgPerDay == null || !Number.isFinite(avgPerDay)) return null;
  if (benchmark === 0) return avgPerDay > 0 ? 0 : cap;
  if (avgPerDay === 0) return cap;
  return Math.min(benchmark / avgPerDay, cap);
};

const groupKey = (row, groupBy) => groupBy.map((field) => row[field]).join("|");

// Port of calculations.R's compute_route_rankings(): aggregates daily rows
// over the period per group (route, or route+operator), scores each of the
// six KPIs, and produces a ranked composite score.
export const computeRankings = (dailyRows, kpiSettings, groupBy = ["provider", "route"]) => {
  const groups = new Map();
  for (const row of dailyRows) {
    const key = groupKey(row, groupBy);
    if (!groups.has(key)) {
      groups.set(key, { ...Object.fromEntries(groupBy.map((f) => [f, row[f]])), rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  const { weights, scoreCap } = kpiSettings;

  const entries = Array.from(groups.values()).map((group) => {
    const { rows } = group;
    const avgOtp = safeMean(rows.map((r) => r.otp));
    const avgShf = safeMean(rows.map((r) => r.shf));
    const avgTpsh = safeMean(rows.map((r) => r.tpsh));
    const daysTracked = rows.length;
    const avgRouteClosures = rows.reduce((s, r) => s + r.routeClosures, 0) / daysTracked;
    const avgLateFirst = rows.reduce((s, r) => s + r.lateToFirst, 0) / daysTracked;
    const avgLateDeploy = rows.reduce((s, r) => s + r.lateDeploy, 0) / daysTracked;

    const otpScore = scoreHigherIsBetter(avgOtp, kpiSettings.otpThresh, scoreCap);
    const shfScore = scoreHigherIsBetter(avgShf, kpiSettings.shfThresh, scoreCap);
    const tpshScore = scoreHigherIsBetter(avgTpsh, kpiSettings.tpshBench, scoreCap);
    const routeClosureScore = scoreLowerIsBetter(avgRouteClosures, kpiSettings.routeClosureBench, scoreCap);
    const lateFirstScore = scoreLowerIsBetter(avgLateFirst, kpiSettings.lateFirstBench, scoreCap);
    const lateDeployScore = scoreLowerIsBetter(avgLateDeploy, kpiSettings.lateDeployBench, scoreCap);

    const weightSum =
      weights.otp + weights.shf + weights.tpsh + weights.routeClosure + weights.lateFirst + weights.lateDeploy;
    const composite = weightSum
      ? (weights.otp * (otpScore ?? 0) +
          weights.shf * (shfScore ?? 0) +
          weights.tpsh * (tpshScore ?? 0) +
          weights.routeClosure * (routeClosureScore ?? 0) +
          weights.lateFirst * (lateFirstScore ?? 0) +
          weights.lateDeploy * (lateDeployScore ?? 0)) /
        weightSum
      : 0;

    const meetsOtp = avgOtp != null && avgOtp >= kpiSettings.otpThresh;
    const meetsShf = avgShf != null && avgShf >= kpiSettings.shfThresh;
    const meetsTpsh = avgTpsh != null && avgTpsh >= kpiSettings.tpshBench;
    const meetsRouteClosure = avgRouteClosures <= kpiSettings.routeClosureBench;
    const meetsLateFirst = avgLateFirst <= kpiSettings.lateFirstBench;
    const meetsLateDeploy = avgLateDeploy <= kpiSettings.lateDeployBench;

    const failedKpis = [
      !meetsOtp && "OTP",
      !meetsShf && "SHF",
      !meetsTpsh && "TPSH",
      !meetsRouteClosure && "Route Closures",
      !meetsLateFirst && "Late to First",
      !meetsLateDeploy && "Late Deploy",
    ].filter(Boolean);

    const totalTrips = rows.reduce((s, r) => s + r.totalTrips, 0);
    const totalActualHrs = rows.reduce((s, r) => s + r.actualHrs, 0);
    const totalSchedHrs = rows.reduce((s, r) => s + r.schedHrs, 0);

    return {
      ...Object.fromEntries(groupBy.map((f) => [f, group[f]])),
      kpiKey: `${group.provider?.toLowerCase()}|${group.route?.toLowerCase()}`,
      daysTracked,
      avgOtp: round2(avgOtp),
      avgShf: round2(avgShf),
      avgTpsh: round2(avgTpsh),
      avgRouteClosures: round2(avgRouteClosures),
      avgLateFirst: round2(avgLateFirst),
      avgLateDeploy: round2(avgLateDeploy),
      totalTrips,
      totalActualHrs: round2(totalActualHrs),
      totalSchedHrs: round2(totalSchedHrs),
      composite: round2(composite),
      meetsOtp,
      meetsShf,
      meetsTpsh,
      meetsRouteClosure,
      meetsLateFirst,
      meetsLateDeploy,
      failedKpis,
    };
  });

  entries.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    if ((b.avgOtp ?? -1) !== (a.avgOtp ?? -1)) return (b.avgOtp ?? -1) - (a.avgOtp ?? -1);
    if ((b.avgShf ?? -1) !== (a.avgShf ?? -1)) return (b.avgShf ?? -1) - (a.avgShf ?? -1);
    if ((b.avgTpsh ?? -1) !== (a.avgTpsh ?? -1)) return (b.avgTpsh ?? -1) - (a.avgTpsh ?? -1);
    if (a.provider !== b.provider) return String(a.provider).localeCompare(String(b.provider));
    return String(a.route).localeCompare(String(b.route), undefined, { numeric: true });
  });

  entries.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  return entries;
};

// Port of calculations.R's network_summary(): totals plus ratio-of-sums
// (days-worked-weighted) network-wide OTP/SHF/TPSH, distinct from the
// unweighted per-route means used inside computeRankings.
export const networkSummary = (dailyRows, rankings) => {
  const serviceRows = dailyRows.filter((r) => !r.isClosureOnly);
  const totalTrips = dailyRows.reduce((s, r) => s + r.totalTrips, 0);
  const totalActualHrs = dailyRows.reduce((s, r) => s + r.actualHrs, 0);
  const totalSchedHrs = dailyRows.reduce((s, r) => s + r.schedHrs, 0);
  const totalClosures = dailyRows.reduce((s, r) => s + r.routeClosures, 0);
  const totalLateFirst = dailyRows.reduce((s, r) => s + r.lateToFirst, 0);
  const totalLateDeploy = dailyRows.reduce((s, r) => s + r.lateDeploy, 0);

  return {
    totalRoutes: rankings.length,
    totalTrips,
    totalActualHrs: round2(totalActualHrs),
    totalSchedHrs: round2(totalSchedHrs),
    avgOtp: round2(safeMean(serviceRows.map((r) => r.otp))),
    avgShf: totalSchedHrs > 0 ? round2(totalActualHrs / totalSchedHrs) : null,
    avgTpsh: totalActualHrs > 0 ? round2(totalTrips / totalActualHrs) : null,
    totalClosures,
    totalLateFirst,
    totalLateDeploy,
    routesAtTarget: rankings.filter((r) => r.meetsOtp && r.meetsShf && r.meetsTpsh).length,
    avgComposite: round2(safeMean(rankings.map((r) => r.composite))),
  };
};
