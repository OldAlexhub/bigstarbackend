import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageWrite } from "../middleware/access.js";
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
router.post("/", requirePageWrite("master_run_cuts.run_cuts"), createRunCut);
router.patch("/:id", requirePageWrite("master_run_cuts.run_cuts"), updateRunCut);
router.delete("/:id", requirePageWrite("master_run_cuts.run_cuts"), deleteRunCut);

export default router;
