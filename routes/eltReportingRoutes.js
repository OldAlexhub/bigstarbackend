import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireELT } from "../middleware/access.js";
import { getEltReport, exportEltReport } from "../controllers/eltReportingController.js";

const router = Router();

router.use(protect, requireELT);

router.get("/", getEltReport);
router.get("/export", exportEltReport);

export default router;
