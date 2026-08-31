import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import { getTracker, getTrackerAllDivisions } from "../controllers/trackerController.js";

const router = Router();

router.use(protect, requireSection("master_run_cuts"));

router.get("/all", getTrackerAllDivisions);
router.get("/", getTracker);

export default router;
