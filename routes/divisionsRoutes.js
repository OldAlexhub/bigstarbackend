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

router.use(protect, requireAnySection(["master_run_cuts", "deployment", "network_success"]));

router.get("/", listDivisions);
router.post("/", requireELT, createDivision);
router.patch("/:id", updateDivision);
router.delete("/:id", requireELT, deleteDivision);

export default router;
