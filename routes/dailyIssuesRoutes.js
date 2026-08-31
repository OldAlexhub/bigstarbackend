import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  listDailyIssues,
  listDailyIssuesReport,
  exportDailyIssues,
  createDailyIssue,
  updateDailyIssue,
  deleteDailyIssue,
} from "../controllers/dailyIssuesController.js";

const router = Router();

router.use(protect, requireSection("deployment"));

router.get("/", listDailyIssues);
router.get("/report", listDailyIssuesReport);
router.get("/export", exportDailyIssues);
router.post("/", createDailyIssue);
router.patch("/:id", updateDailyIssue);
router.delete("/:id", deleteDailyIssue);

export default router;
