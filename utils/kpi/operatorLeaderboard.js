import { computeRankings } from "./rankings.js";

// Ranks operators company-wide (across every accessible division) using the
// exact same scoring math every other ranking in this app uses -
// computeRankings itself, reused as-is rather than duplicated - grouped by
// operator alone instead of provider+route.
//
// computeRankings's groupBy mechanism only carries the grouping field(s)
// themselves through (its kpiKey is also hardcoded to provider|route, which
// only happens to work today because every existing caller's groupBy
// already includes both) - grouping by operator alone would lose the
// division/provider columns and produce a colliding kpiKey. Division and
// provider are attached here as a separate display-only pass over the same
// rows instead, and kpiKey is replaced with something actually unique per
// operator.
//
// Each row in dailyRowsWithDivision must already carry a `division` display
// field (buildTrackerRows itself doesn't know which division it was called
// for) alongside the usual operator/provider/shf/tpsh/otp/etc. fields
// routeDailyData produces.
export const rankOperatorsAcrossDivisions = (dailyRowsWithDivision, kpiSettings) => {
  const rankings = computeRankings(dailyRowsWithDivision, kpiSettings, ["operator"]);

  const displayByOperator = new Map();
  for (const row of dailyRowsWithDivision) {
    if (!row.operator || row.operator === "Unassigned") continue;
    if (!displayByOperator.has(row.operator)) {
      displayByOperator.set(row.operator, { divisions: new Set(), providerCounts: new Map() });
    }
    const entry = displayByOperator.get(row.operator);
    if (row.division) entry.divisions.add(row.division);
    if (row.provider && row.provider !== "Unassigned") {
      entry.providerCounts.set(row.provider, (entry.providerCounts.get(row.provider) || 0) + 1);
    }
  }

  const ranked = rankings
    // "Unassigned" is a placeholder for "no operator on record," not a real
    // person - it shouldn't occupy a leaderboard slot.
    .filter((r) => r.operator && r.operator !== "Unassigned")
    .map((r) => {
      const display = displayByOperator.get(r.operator);
      const divisions = display ? [...display.divisions].sort().join(", ") : "";
      const topProvider = display
        ? [...display.providerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        : null;
      return { ...r, kpiKey: r.operator.toLowerCase(), divisions, provider: topProvider || "Unassigned" };
    })
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));

  ranked.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  return ranked;
};
