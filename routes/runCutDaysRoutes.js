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

router.use(protect, requireAnySection(["master_run_cuts", "deployment", "network_success"]));

router.get("/", listRunCutDays);
router.post("/", createExtraRunCutDay);
router.patch("/:id/deployed", setRunCutDayDeployed);
router.patch("/:id", updateRunCutDayException);
router.delete("/:id", deleteExtraRunCutDay);

export default router;
