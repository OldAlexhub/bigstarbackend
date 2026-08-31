import Vehicle from "../models/Vehicle.js";
import Division from "../models/Division.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";

export const listVehicles = async (req, res) => {
  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const vehicles = await Vehicle.find({ division: req.query.division })
      .sort({ code: 1 })
      .populate("division", "code name");
    return res.json({ vehicles });
  }

  const accessibleDivisionIds = await Division.find(divisionFilter(req.user)).distinct("_id");
  const vehicles = await Vehicle.find({ division: { $in: accessibleDivisionIds } })
    .sort({ code: 1 })
    .populate("division", "code name");
  res.json({ vehicles });
};

export const createVehicle = async (req, res) => {
  const { division, code } = req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const vehicle = await Vehicle.create({ division, code });
  res.status(201).json({ vehicle });
};

export const updateVehicle = async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
  if (!canAccessDivision(req.user, vehicle.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { code, active } = req.body;
  if (code !== undefined) vehicle.code = code;
  if (active !== undefined) vehicle.active = active;
  await vehicle.save();
  res.json({ vehicle });
};

export const deleteVehicle = async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
  if (!canAccessDivision(req.user, vehicle.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  await vehicle.deleteOne();
  res.json({ message: "Vehicle deleted" });
};
