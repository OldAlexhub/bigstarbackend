import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listRunCuts,
  createRunCut,
  updateRunCut,
  deleteRunCut,
} from "../controllers/runCutsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listRunCuts);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), createRunCut);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateRunCut);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), deleteRunCut);

export default router;
