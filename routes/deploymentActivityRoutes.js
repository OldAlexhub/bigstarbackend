import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import { listDeploymentActivity } from "../controllers/deploymentActivityController.js";

const router = Router();

router.use(protect, requireSection("deployment"));

router.get("/", listDeploymentActivity);

export default router;
