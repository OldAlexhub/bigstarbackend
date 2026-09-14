import mongoose from "mongoose";
import ReallocationRequest from "../models/ReallocationRequest.js";
import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { parseDateOnly } from "../utils/dateRange.js";
import { approveOrApplyReallocation, normalizeReallocationAssignment } from "../utils/reallocationRequests.js";
import { respondToHttpError } from "../utils/httpError.js";

const populateRequest = (query) =>
  query
    .populate("division", "code name timezone")
    .populate("requestedBy", "name username")
    .populate("reviewedBy", "name username");

const clean = (value) => String(value || "").trim();

const countsByDivision = (requests) => requests.reduce((counts, request) => {
  const key = String(request.division);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const requestForUser = (request, user) => {
  const value = request.toObject ? request.toObject() : request;
  const seenBy = value.networkSeenBy || [];
  delete value.networkSeenBy;
  return {
    ...value,
    networkUnread:
      value.status !== "pending" &&
      !seenBy.some((userId) => String(userId) === String(user._id)),
  };
};

export const listReallocationRequests = async (req, res) => {
  const { division } = req.query;
  if (!mongoose.isValidObjectId(division)) {
    return res.status(400).json({ message: "Choose a division." });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const [requests, pendingCount] = await Promise.all([
    populateRequest(ReallocationRequest.find({ division }).sort({ createdAt: -1 }).limit(250)),
    ReallocationRequest.countDocuments({ division, status: "pending" }),
  ]);
  res.json({ requests: requests.map((request) => requestForUser(request, req.user)), pendingCount });
};

export const getReallocationNotifications = async (req, res) => {
  const divisionIds = await Division.find(divisionFilter(req.user)).distinct("_id");
  const unread = await ReallocationRequest.find({
    division: { $in: divisionIds },
    status: { $in: ["approved", "applied"] },
    networkSeenBy: { $ne: req.user._id },
  }).select("division").lean();
  res.json({ count: unread.length, byDivision: countsByDivision(unread) });
};

export const getPendingReallocationNotifications = async (req, res) => {
  const divisionIds = await Division.find(divisionFilter(req.user)).distinct("_id");
  const pending = await ReallocationRequest.find({
    division: { $in: divisionIds },
    status: "pending",
  }).select("division").lean();
  res.json({ count: pending.length, byDivision: countsByDivision(pending) });
};

export const acknowledgeReallocationNotifications = async (req, res) => {
  const { division } = req.body;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a division." });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const result = await ReallocationRequest.updateMany(
    { division, status: { $in: ["approved", "applied"] }, networkSeenBy: { $ne: req.user._id } },
    { $addToSet: { networkSeenBy: req.user._id } }
  );
  res.json({ acknowledged: result.modifiedCount || 0 });
};

export const createReallocationRequest = async (req, res) => {
  const { division, runCut, destinationRunCut, effectiveDate } = req.body;
  if (!mongoose.isValidObjectId(division) || !mongoose.isValidObjectId(runCut)) {
    return res.status(400).json({ message: "Choose a division and current route." });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const parsedDate = parseDateOnly(effectiveDate, "effectiveDate");
  if (parsedDate.error) return res.status(400).json({ message: parsedDate.error });

  const requestedOperatorName = clean(req.body.operatorName);
  let requestedVehicleCode = clean(req.body.vehicleCode);
  let requestedPulloutAddress = clean(req.body.pulloutAddress);
  if (requestedOperatorName.length > 120 || requestedVehicleCode.length > 50 || requestedPulloutAddress.length > 300) {
    return res.status(400).json({ message: "One or more requested assignment fields are too long." });
  }

  const current = await RunCut.findById(runCut)
    .populate("route", "code")
    .populate("operator", "name")
    .populate("vehicle", "code");
  if (!current || String(current.division) !== String(division)) {
    return res.status(404).json({ message: "Current route assignment not found." });
  }

  let destination = null;
  if (destinationRunCut && String(destinationRunCut) !== String(runCut)) {
    if (!mongoose.isValidObjectId(destinationRunCut)) {
      return res.status(400).json({ message: "Choose a valid destination route." });
    }
    destination = await RunCut.findById(destinationRunCut)
      .populate("route", "code")
      .populate("operator", "name")
      .populate("vehicle", "code");
    if (!destination || String(destination.division) !== String(division)) {
      return res.status(404).json({ message: "Destination route assignment not found." });
    }
    if (destination.operator) {
      return res.status(409).json({ message: `Route ${destination.route?.code || "selected"} is already assigned. Choose an unassigned destination route.` });
    }
    if (destination.status !== "unassigned") {
      return res.status(409).json({ message: `Route ${destination.route?.code || "selected"} must be marked Unassigned in Master Run Cuts before it can receive this assignment.` });
    }
  }

  ({ vehicleCode: requestedVehicleCode, pulloutAddress: requestedPulloutAddress } = normalizeReallocationAssignment({
    movingRoutes: Boolean(destination),
    operatorName: requestedOperatorName,
    vehicleCode: requestedVehicleCode,
    pulloutAddress: requestedPulloutAddress,
  }));

  const originalOperatorName = current.operator?.name || "";
  const originalVehicleCode = current.vehicle?.code || "";
  const originalPulloutAddress = current.pulloutAddress || "";
  const changed = Boolean(destination) ||
    originalOperatorName.toLowerCase() !== requestedOperatorName.toLowerCase() ||
    originalVehicleCode.toLowerCase() !== requestedVehicleCode.toLowerCase() ||
    originalPulloutAddress !== requestedPulloutAddress;
  if (!changed) return res.status(400).json({ message: "Enter at least one assignment change." });

  try {
    const duplicate = await ReallocationRequest.findOne({
      open: true,
      involvedRunCuts: { $in: [current._id, destination?._id].filter(Boolean) },
    }).select("_id");
    if (duplicate) {
      return res.status(409).json({ message: "One of these routes already has a pending reallocation request." });
    }

    const created = await ReallocationRequest.create({
      division,
      runCut: current._id,
      involvedRunCuts: [current._id, destination?._id].filter(Boolean),
      route: current.route._id,
      routeCode: current.route.code,
      destinationRunCut: destination?._id || null,
      destinationRoute: destination?.route?._id || null,
      destinationRouteCode: destination?.route?.code || "",
      destinationOriginalOperatorName: destination?.operator?.name || "",
      destinationOriginalVehicleCode: destination?.vehicle?.code || "",
      destinationOriginalPulloutAddress: destination?.pulloutAddress || "",
      originalOperatorName,
      originalVehicleCode,
      originalPulloutAddress,
      requestedOperatorName,
      requestedVehicleCode,
      requestedPulloutAddress,
      effectiveDate: parsedDate.date,
      requestedBy: req.user._id,
      requestedByName: req.user.name || "",
      requestedByUsername: req.user.username || "",
    });
    const request = await populateRequest(ReallocationRequest.findById(created._id));
    res.status(201).json({ request });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "This route already has a pending reallocation request." });
    }
    throw error;
  }
};

export const acceptReallocationRequest = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid reallocation request." });
  }

  const existing = await ReallocationRequest.findById(req.params.id).select("division status");
  if (!existing) return res.status(404).json({ message: "Reallocation request not found." });
  if (!canAccessDivision(req.user, existing.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  try {
    const result = await approveOrApplyReallocation(existing._id, req.user);
    res.json({
      ...result,
      message: result.applied
        ? "Reallocation accepted and applied to the Master Run Cut."
        : "Reallocation accepted and scheduled for its effective date.",
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }
};
