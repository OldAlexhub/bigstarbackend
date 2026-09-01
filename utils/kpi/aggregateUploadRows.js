// Collapses upload rows that resolved to the same {routeId, date} - e.g.
// "1101" and "1101-B" both resolving to route "1101" on the same day - into
// one row, since DailyKpiEntry has a unique {division, route, date} index
// and can hold only one entry per route/day. Additive fields sum; OTP % is
// a trips-weighted average (not a plain mean), so a 20-trip row and a
// 2-trip row don't count equally.
//
// Expects each row to already carry routeId, routeCode, and sourceRoute
// (the raw un-resolved text, e.g. "1101-B") alongside the usual
// date/actualHours/totalTrips/otpPct/routeClosures/lateToFirst/lateDeploy.
export const aggregateUploadRows = (resolvedRows) => {
  const groups = new Map();
  for (const row of resolvedRows) {
    const key = `${row.routeId}|${row.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const rows = [];
  const mergeNotes = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      rows.push(group[0]);
      continue;
    }

    const totalTrips = group.reduce((s, r) => s + r.totalTrips, 0);
    const otpPct =
      totalTrips > 0
        ? group.reduce((s, r) => s + r.otpPct * r.totalTrips, 0) / totalTrips
        : group.reduce((s, r) => s + r.otpPct, 0) / group.length; // all-zero-trips fallback: plain mean

    const schedHoursValues = group.map((r) => r.schedHours).filter((v) => v != null);

    rows.push({
      ...group[0],
      actualHours: Math.round(group.reduce((s, r) => s + r.actualHours, 0) * 100) / 100,
      totalTrips: Math.round(totalTrips),
      otpPct,
      routeClosures: group.reduce((s, r) => s + r.routeClosures, 0),
      lateToFirst: group.reduce((s, r) => s + r.lateToFirst, 0),
      lateDeploy: group.reduce((s, r) => s + r.lateDeploy, 0),
      schedHours: schedHoursValues.length ? Math.round(schedHoursValues.reduce((s, v) => s + v, 0) * 100) / 100 : null,
      provider: group.map((r) => r.provider).find((p) => p != null) ?? null,
      operator: group.map((r) => r.operator).find((o) => o != null) ?? null,
      mergedFrom: group.map((r) => r.sourceRoute),
    });
    mergeNotes.push(
      `${group[0].date}: rows for "${group.map((r) => r.sourceRoute).join('", "')}" were combined into one entry for route "${group[0].routeCode}" (same route, same day).`
    );
  }
  return { rows, mergeNotes };
};
