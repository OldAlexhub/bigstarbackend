// OSR ("Out of Service Request") is the one disruption type with an
// automated side effect: picking it also suspends the route for tomorrow
// only (see runCutDaysController.updateRunCutDayException) — a day-specific
// override, same as everything else Deployment sets, so it auto-reverts the
// day after instead of touching the ongoing Master Run Cuts plan.
export const OSR_DISRUPTION_TYPE = "OSR (Out of Service Request)";

export const DISRUPTION_TYPES = [
  "Adverse Operational Behavior",
  "Hotline Misuse",
  "Unperformed Duty",
  "Route Closed",
  OSR_DISRUPTION_TYPE,
  "Late to First",
  "Late to Zone",
  "Incorrect Service Request",
  "Late Service Request Submission",
  "Non-Deployment Issue",
  "Unreported Swap-Operator",
  "Unreported Swap-Vehicle",
  "Vehicle Breakdown",
  "Technical Malfunction",
  "Phone Login",
  "Late Deploy",
];
