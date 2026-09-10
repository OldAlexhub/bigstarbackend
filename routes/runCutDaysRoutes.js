import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listRunCutDays,
  setRunCutDayDeployed,
  updateRunCutDayException,
  createExtraRunCutDay,
  deleteExtraRunCutDay,
} from "../controllers/runCutDaysController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listRunCutDays);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), createExtraRunCutDay);
router.patch("/:id/deployed", requireAnySection(["master_run_cuts", "deployment"]), setRunCutDayDeployed);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateRunCutDayException);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), deleteExtraRunCutDay);

export default router;
