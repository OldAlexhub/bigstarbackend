import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import { canAccessDivision } from "../middleware/access.js";

export const listDeploymentActivity = async (req, res) => {
  const { division, from, to } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const query = { division };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) query.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const entries = await DeploymentActivityLog.find(query).sort({ createdAt: -1 }).limit(500);
  res.json({ entries });
};
