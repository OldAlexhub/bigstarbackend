import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection, requireELT } from "../middleware/access.js";
import {
  listDivisions,
  createDivision,
  updateDivision,
  deleteDivision,
} from "../controllers/divisionsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listDivisions);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), requireELT, createDivision);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateDivision);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), requireELT, deleteDivision);

export default router;
