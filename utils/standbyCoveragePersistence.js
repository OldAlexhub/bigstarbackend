import RunCutDay from "../models/RunCutDay.js";
import { removeStandbyCoverageFromRoute } from "./dispositions.js";

// A standby day can disappear when its route is retired or its recurring
// schedule changes. Restore every covered route it owned before deleting the
// source day so temporary pullout addresses never become permanent.
export const restoreCoverageOwnedByStandbyDays = async (standbyDayIds, updatedBy = null) => {
  if (!standbyDayIds?.length) return;
  const idSet = new Set(standbyDayIds.map(String));
  const coveredDays = await RunCutDay.find({
    $or: [
      { dispositionStandbyDay: { $in: standbyDayIds } },
      { pulloutAddressStandbyDay: { $in: standbyDayIds } },
    ],
  });

  await Promise.all(
    coveredDays.map(async (coveredDay) => {
      const ownerIds = [coveredDay.dispositionStandbyDay, coveredDay.pulloutAddressStandbyDay]
        .filter((id) => id && idSet.has(String(id)));
      let changed = false;
      for (const ownerId of [...new Set(ownerIds.map(String))]) {
        changed = removeStandbyCoverageFromRoute(coveredDay, ownerId) || changed;
      }
      if (!changed) return;
      if (updatedBy) coveredDay.updatedBy = updatedBy;
      await coveredDay.save();
    })
  );
};
