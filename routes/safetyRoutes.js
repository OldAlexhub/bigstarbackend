import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  deleteSafetyEntry,
  deleteSafetyScore,
  getSafetyAnalytics,
  listSafetyEntries,
  listSafetyScores,
  saveSafetyEntry,
  saveSafetyScore,
} from "../controllers/safetyController.js";

const router = Router();

router.use(protect, requireSection("safety"));
router.get("/entries", listSafetyEntries);
router.put("/entries", saveSafetyEntry);
router.delete("/entries/:id", deleteSafetyEntry);
router.get("/scores", listSafetyScores);
router.put("/scores", saveSafetyScore);
router.delete("/scores/:id", deleteSafetyScore);
router.get("/analytics", getSafetyAnalytics);

export default router;
