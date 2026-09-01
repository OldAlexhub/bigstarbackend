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

router.use(protect, requireAnySection(["master_run_cuts", "deployment"]));

router.get("/", listRunCuts);
router.post("/", createRunCut);
router.patch("/:id", updateRunCut);
router.delete("/:id", deleteRunCut);

export default router;
