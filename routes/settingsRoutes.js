import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection, requireSection, requireELT } from "../middleware/access.js";
import {
  getOperationsKpiSettings,
  getSettings,
  saveOperationsKpiSetting,
  updateSettings,
} from "../controllers/settingsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment"]), getSettings);
router.put("/", requireSection("master_run_cuts"), requireELT, updateSettings);
router.get("/operations-kpis", requireSection("master_run_cuts"), getOperationsKpiSettings);
router.put("/operations-kpis", requireSection("master_run_cuts"), requireELT, saveOperationsKpiSetting);

export default router;
