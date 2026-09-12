import { reconcileAllClosedOperationsMonths } from "../utils/operationsReporting.js";

export const scheduleOperationsReconciliation = () => {
  reconcileAllClosedOperationsMonths().catch((error) => console.error("Operations reconciliation failed:", error));
  return setInterval(() => {
    reconcileAllClosedOperationsMonths().catch((error) => console.error("Operations reconciliation failed:", error));
  }, 24 * 60 * 60 * 1000);
};
