export const STANDBY_DISPOSITION = "deployed_stby";
export const CLOSED_SUSPENDED_DISPOSITION = "closed_suspended";

export const DISPOSITION_TYPES = [
  "deployed_on_time",
  "deployed_late",
  STANDBY_DISPOSITION,
  "reallocated",
  CLOSED_SUSPENDED_DISPOSITION,
];

// A suspended live-day status owns its matching outcome. Keeping a distinct
// source lets changing the status back clear only the automatic outcome,
// without erasing a disposition that dispatch selected manually.
export const syncDispositionWithStatus = (runCutDay, status) => {
  if (status === "suspended") {
    runCutDay.disposition = CLOSED_SUSPENDED_DISPOSITION;
    runCutDay.dispositionSource = "status";
    runCutDay.dispositionStandbyDay = null;
    return true;
  }

  if (runCutDay.dispositionSource === "status") {
    runCutDay.disposition = null;
    runCutDay.dispositionSource = null;
    runCutDay.dispositionStandbyDay = null;
    return true;
  }

  return false;
};

// The same invariant applies in the other direction: choosing the
// Closed/Suspended outcome makes Suspended the live-day status and lets the
// status own the disposition from then on.
export const syncStatusWithDisposition = (runCutDay, disposition) => {
  if (disposition !== CLOSED_SUSPENDED_DISPOSITION) return false;

  runCutDay.status = "suspended";
  syncDispositionWithStatus(runCutDay, "suspended");
  return true;
};

// Covering a route with standby means that duty is operating. Keep the
// route's status and final outcome aligned in the same update.
export const activateRouteWithStandbyCoverage = (
  runCutDay,
  standbyRunCutDayId,
  standbyPulloutAddress
) => {
  const alreadyOwnsRouteState =
    String(runCutDay.routeStateStandbyDay || "") === String(standbyRunCutDayId);
  if (!alreadyOwnsRouteState) {
    runCutDay.routeStateStandbyDay = standbyRunCutDayId;
    runCutDay.statusBeforeStandby = runCutDay.status;
    runCutDay.statusOverrideBeforeStandby = Boolean(runCutDay.overrides?.status);
    runCutDay.serviceHoursBeforeStandby = runCutDay.serviceHours ?? 0;
    runCutDay.revenueHoursBeforeStandby = runCutDay.revenueHours ?? 0;
    runCutDay.dispositionBeforeStandby = runCutDay.disposition || null;
    runCutDay.dispositionSourceBeforeStandby = runCutDay.dispositionSource || null;
    runCutDay.dispositionStandbyDayBeforeStandby = runCutDay.dispositionStandbyDay || null;
  }

  runCutDay.status = "active";
  runCutDay.disposition = STANDBY_DISPOSITION;
  runCutDay.dispositionSource = "standby";
  runCutDay.dispositionStandbyDay = standbyRunCutDayId;

  if (standbyPulloutAddress !== undefined) {
    const alreadyOwnedByThisStandby =
      String(runCutDay.pulloutAddressStandbyDay || "") === String(standbyRunCutDayId);
    if (!alreadyOwnedByThisStandby) {
      runCutDay.pulloutAddressBeforeStandby = runCutDay.pulloutAddress || "";
      runCutDay.pulloutAddressOverrideBeforeStandby = Boolean(runCutDay.overrides?.pulloutAddress);
    }
    runCutDay.pulloutAddress = standbyPulloutAddress || "";
    runCutDay.pulloutAddressStandbyDay = standbyRunCutDayId;
    if (runCutDay.overrides) runCutDay.overrides.pulloutAddress = true;
  }
};

export const removeStandbyCoverageFromRoute = (runCutDay, standbyRunCutDayId) => {
  let changed = false;
  const standbyOwnsRouteState =
    String(runCutDay.routeStateStandbyDay || "") === String(standbyRunCutDayId);
  const standbyOwnsDisposition =
    runCutDay.disposition === STANDBY_DISPOSITION &&
    runCutDay.dispositionSource === "standby" &&
    String(runCutDay.dispositionStandbyDay || "") === String(standbyRunCutDayId);

  if (standbyOwnsRouteState) {
    runCutDay.status = runCutDay.statusBeforeStandby;
    if (runCutDay.overrides) {
      runCutDay.overrides.status = Boolean(runCutDay.statusOverrideBeforeStandby);
    }
    runCutDay.serviceHours = runCutDay.serviceHoursBeforeStandby ?? 0;
    runCutDay.revenueHours = runCutDay.revenueHoursBeforeStandby ?? 0;
    runCutDay.disposition = runCutDay.dispositionBeforeStandby || null;
    runCutDay.dispositionSource = runCutDay.dispositionSourceBeforeStandby || null;
    runCutDay.dispositionStandbyDay = runCutDay.dispositionStandbyDayBeforeStandby || null;

    runCutDay.routeStateStandbyDay = null;
    runCutDay.statusBeforeStandby = null;
    runCutDay.statusOverrideBeforeStandby = false;
    runCutDay.serviceHoursBeforeStandby = null;
    runCutDay.revenueHoursBeforeStandby = null;
    runCutDay.dispositionBeforeStandby = null;
    runCutDay.dispositionSourceBeforeStandby = null;
    runCutDay.dispositionStandbyDayBeforeStandby = null;
    changed = true;
  } else if (standbyOwnsDisposition) {
    runCutDay.disposition = null;
    runCutDay.dispositionSource = null;
    runCutDay.dispositionStandbyDay = null;
    changed = true;
  }

  const standbyOwnsPullout =
    String(runCutDay.pulloutAddressStandbyDay || "") === String(standbyRunCutDayId);
  if (standbyOwnsPullout) {
    runCutDay.pulloutAddress = runCutDay.pulloutAddressBeforeStandby || "";
    if (runCutDay.overrides) {
      runCutDay.overrides.pulloutAddress = Boolean(runCutDay.pulloutAddressOverrideBeforeStandby);
    }
    runCutDay.pulloutAddressStandbyDay = null;
    runCutDay.pulloutAddressBeforeStandby = "";
    runCutDay.pulloutAddressOverrideBeforeStandby = false;
    changed = true;
  }

  return changed;
};
