import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess } from "../middleware/access.js";
import {
  listRunCuts,
  createRunCut,
  updateRunCut,
  deleteRunCut,
} from "../controllers/runCutsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess([
  "master_run_cuts.run_cuts",
  "deployment.live_schedule",
  "deployment.issue_log",
  "network_success.reallocation_requests",
]), listRunCuts);
router.post("/", requirePageAccess("master_run_cuts.run_cuts"), createRunCut);
router.patch("/:id", requirePageAccess("master_run_cuts.run_cuts"), updateRunCut);
router.delete("/:id", requirePageAccess("master_run_cuts.run_cuts"), deleteRunCut);

export default router;
