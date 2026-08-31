import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import { getDailyScheduleReport } from "../controllers/dailyScheduleReportController.js";

const router = Router();

router.use(protect, requireSection("deployment"));

router.get("/daily-schedule", getDailyScheduleReport);

export default router;
