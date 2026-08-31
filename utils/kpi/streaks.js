// Port of calculations.R's compute_streaks(): walks the trailing weekly
// windows backward from the most recent week, counting how many consecutive
// weeks a route stayed in the Top-5 / Bottom-5 band, then classifies a
// status label from streak length plus whether its rank improved.
//
// `weeklyWindows` is oldest-first (as returned by weeklySeries), most recent
// week last — matching what the "Week of" picker's trailing series produces.
export const computeStreaks = (weeklyWindows) => {
  if (!weeklyWindows.length) return { top: [], bottom: [] };

  const current = weeklyWindows[weeklyWindows.length - 1];
  const previous = weeklyWindows.length > 1 ? weeklyWindows[weeklyWindows.length - 2] : null;
  const totalRoutes = current.rankings.length;

  const inTop5 = (entry) => entry.rank <= 5;
  const inBottom5 = (entry, total) => entry.rank > total - 5;

  const streakLength = (kpiKey, inBandFn) => {
    let count = 0;
    for (let i = weeklyWindows.length - 1; i >= 0; i -= 1) {
      const week = weeklyWindows[i];
      const entry = week.rankings.find((r) => r.kpiKey === kpiKey);
      if (!entry || !inBandFn(entry, week.rankings.length)) break;
      count += 1;
    }
    return count;
  };

  const classifyTop = (streak, rankChange) => {
    if (streak >= 4) return "Elite";
    if (streak >= 2 && rankChange > 0) return "Rising Star";
    if (streak >= 2) return "Sustained";
    return null;
  };

  const classifyBottom = (streak, rankChange) => {
    if (streak >= 3 && rankChange <= 0) return "Act Now";
    if (streak >= 2 && rankChange > 0) return "Improving";
    if (streak >= 2 && rankChange < 0) return "Worsening";
    if (streak >= 2) return "Stagnant";
    return null;
  };

  const buildBadges = (entries, inBandFn, classify) =>
    entries.map((entry) => {
      const streak = streakLength(entry.kpiKey, inBandFn);
      const priorEntry = previous?.rankings.find((r) => r.kpiKey === entry.kpiKey);
      const rankChange = priorEntry ? priorEntry.rank - entry.rank : 0;
      return {
        ...entry,
        streak,
        rankChange,
        streakStatus: streak >= 2 ? classify(streak, rankChange) : null,
      };
    });

  const top5 = current.rankings.filter(inTop5);
  const bottom5 = current.rankings.filter((r) => inBottom5(r, totalRoutes));

  return {
    top: buildBadges(top5, inTop5, classifyTop),
    bottom: buildBadges(bottom5, (entry) => inBottom5(entry, totalRoutes), classifyBottom),
  };
};
