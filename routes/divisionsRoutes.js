import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess, requireELT } from "../middleware/access.js";
import { PAGE_ACCESS } from "../utils/pageAccess.js";
import {
  listDivisions,
  createDivision,
  updateDivision,
  deleteDivision,
} from "../controllers/divisionsController.js";

const router = Router();

router.use(protect);

const divisionPages = PAGE_ACCESS.filter((page) => !["dashboard", "leaderboard"].includes(page));

router.get("/", requireAnyPageAccess(divisionPages), listDivisions);
router.post("/", requirePageAccess("master_run_cuts.run_cuts"), requireELT, createDivision);
router.patch("/:id", requirePageAccess("settings.general"), updateDivision);
router.delete("/:id", requirePageAccess("settings.general"), requireELT, deleteDivision);

export default router;
