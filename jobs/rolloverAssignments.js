import RunCut from "../models/RunCut.js";
import { projectAssignment } from "../utils/projectAssignment.js";

// Keeps RunCutDay coverage rolling forward automatically from each route's
// live RunCut assignment, so a route someone set up last month keeps
// generating today's/tomorrow's schedule without anyone touching it.
export const rolloverAssignments = async () => {
  const runCuts = await RunCut.find({});
  for (const runCut of runCuts) {
    await projectAssignment(runCut, null);
  }
};

export const scheduleAssignmentRollover = () => {
  rolloverAssignments().catch((error) => console.error("Assignment rollover failed:", error));
  setInterval(() => {
    rolloverAssignments().catch((error) => console.error("Assignment rollover failed:", error));
  }, 24 * 60 * 60 * 1000);
};
