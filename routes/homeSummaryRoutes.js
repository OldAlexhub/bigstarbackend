import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { getHomeSummary } from "../controllers/homeSummaryController.js";

const router = Router();

router.get("/", protect, getHomeSummary);

export default router;
