import { reconcileAllClosedOperationsMonths } from "../utils/operationsReporting.js";

export const scheduleOperationsReconciliation = () => {
  reconcileAllClosedOperationsMonths().catch((error) => console.error("Operations reconciliation failed:", error));
  setInterval(() => {
    reconcileAllClosedOperationsMonths().catch((error) => console.error("Operations reconciliation failed:", error));
  }, 24 * 60 * 60 * 1000);
};
