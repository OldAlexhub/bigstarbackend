import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  addCapNote,
  cancelCap,
  confirmCapRecovery,
  getCapReport,
  getMonthlyDashboard,
  getTracker,
  listCapNeeded,
  listCapPeople,
  listCaps,
  openCap,
  updateCap,
} from "../controllers/operationsReportingController.js";

const router = Router();

router.use(protect, requireSection("operations_reporting"));
router.get("/tracker", getTracker);
router.get("/dashboard", getMonthlyDashboard);
router.get("/caps", listCaps);
router.get("/caps/report", getCapReport);
router.get("/caps/needed", listCapNeeded);
router.post("/caps", openCap);
router.get("/people", listCapPeople);
router.patch("/caps/:id", updateCap);
router.delete("/caps/:id", cancelCap);
router.post("/caps/:id/notes", addCapNote);
router.post("/caps/:id/confirm-recovery", confirmCapRecovery);

export default router;
