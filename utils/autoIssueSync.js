import DailyIssueLog from "../models/DailyIssueLog.js";

// Keeps Deployment's Issue Log in sync with a route's live status/disruption
// (as projected onto each date's RunCutDay), so anything set there is
// visible in one place and counted by Network Success's KPI math — without
// requiring separate manual entry. Each auto-synced record is tied to its
// RunCutDay + a tag identifying which field produced it, so it can be found
// and updated/removed idempotently without colliding with manually-logged
// entries. Batched via bulkWrite since this runs across every projected day
// whenever an assignment changes, not just one record at a time.
export const syncAutoIssuesBulk = async (runCutDays, userId) => {
  const ops = [];

  for (const rcd of runCutDays) {
    ops.push(
      tagOp({
        runCutDay: rcd,
        tag: "status_suspended",
        shouldExist: rcd.status === "suspended",
        disruptionType: "Unperformed Duty",
        notes: "",
        userId,
      })
    );
    ops.push(
      tagOp({
        runCutDay: rcd,
        tag: "disruption_dropdown",
        shouldExist: Boolean(rcd.disruptionType),
        disruptionType: rcd.disruptionType,
        notes: rcd.disruptionNotes || "",
        userId,
      })
    );
  }

  if (ops.length) await DailyIssueLog.bulkWrite(ops);
};

const tagOp = ({ runCutDay, tag, shouldExist, disruptionType, notes, userId }) => {
  const filter = { runCutDay: runCutDay._id, autoSyncTag: tag };

  if (!shouldExist) {
    return { deleteOne: { filter } };
  }

  return {
    updateOne: {
      filter,
      update: {
        $set: {
          division: runCutDay.division,
          route: runCutDay.route,
          operator: runCutDay.operator || null,
          date: runCutDay.date,
          disruptionType,
          notes,
          createdBy: userId,
          runCutDay: runCutDay._id,
          autoSyncTag: tag,
        },
      },
      upsert: true,
    },
  };
};
