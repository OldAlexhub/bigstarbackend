import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection, requireSection } from "../middleware/access.js";
import {
  acceptReallocationRequest,
  acknowledgeReallocationNotifications,
  createReallocationRequest,
  exportReallocationRequests,
  getReallocationNotifications,
  getPendingReallocationNotifications,
  listReallocationRequests,
} from "../controllers/reallocationRequestsController.js";

const router = Router();

router.use(protect);
router.get("/notifications", requireSection("network_success"), getReallocationNotifications);
router.get("/pending-notifications", requireSection("deployment"), getPendingReallocationNotifications);
router.post("/acknowledge", requireSection("network_success"), acknowledgeReallocationNotifications);
router.get("/export", requireAnySection(["network_success", "deployment"]), exportReallocationRequests);
router.get("/", requireAnySection(["network_success", "deployment"]), listReallocationRequests);
router.post("/", requireSection("network_success"), createReallocationRequest);
router.post("/:id/accept", requireSection("deployment"), acceptReallocationRequest);

export default router;
