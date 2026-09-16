import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess, requireELT } from "../middleware/access.js";
import {
  getOperationsKpiSettings,
  getSettings,
  saveOperationsKpiSetting,
  updateSettings,
} from "../controllers/settingsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess(["settings.general", "deployment.live_schedule"]), getSettings);
router.put("/", requirePageAccess("settings.general"), requireELT, updateSettings);
router.get("/operations-kpis", requirePageAccess("settings.general"), getOperationsKpiSettings);
router.put("/operations-kpis", requirePageAccess("settings.general"), requireELT, saveOperationsKpiSetting);

export default router;
