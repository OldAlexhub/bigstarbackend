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
