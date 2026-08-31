import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection, requireELT } from "../middleware/access.js";
import { getSettings, updateSettings } from "../controllers/settingsController.js";

const router = Router();

router.use(protect, requireSection("master_run_cuts"));

router.get("/", getSettings);
router.put("/", requireELT, updateSettings);

export default router;
