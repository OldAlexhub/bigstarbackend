import { applyDueReallocations } from "../utils/reallocationRequests.js";

const APPLY_INTERVAL_MS = 15 * 60 * 1000;

export const scheduleReallocationApplications = () => {
  applyDueReallocations().catch((error) => console.error("Reallocation application failed:", error));
  return setInterval(() => {
    applyDueReallocations().catch((error) => console.error("Reallocation application failed:", error));
  }, APPLY_INTERVAL_MS);
};
