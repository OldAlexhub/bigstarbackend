import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  listKpiEntries,
  createKpiEntry,
  updateKpiEntry,
  deleteKpiEntry,
  preprocessRawReport,
  confirmKpiEntries,
} from "../controllers/networkSuccess/kpiEntriesController.js";
import { getNsSettings, updateNsSettings } from "../controllers/networkSuccess/nsSettingsController.js";
import { getDashboard } from "../controllers/networkSuccess/dashboardController.js";
import { getFulfillmentBrain } from "../controllers/networkSuccess/fulfillmentController.js";
import { getOperationalAnalysis } from "../controllers/networkSuccess/operationalController.js";
import {
  getEodBrief,
  getWeeklyReport,
  getProviderCheckIn,
  getProviderPerformanceReview,
} from "../controllers/networkSuccess/reportsController.js";
import {
  getWeeklyAnalytics,
  getProviderDiagnostics,
  getMonthlyAnalytics,
} from "../controllers/networkSuccess/analyticsController.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.use(protect, requireSection("network_success"));

router.get("/kpi-entries", listKpiEntries);
router.post("/kpi-entries", createKpiEntry);
router.post("/kpi-entries/preprocess", upload.fields([{ name: "file1" }]), preprocessRawReport);
router.post("/kpi-entries/import-confirm", confirmKpiEntries);
router.patch("/kpi-entries/:id", updateKpiEntry);
router.delete("/kpi-entries/:id", deleteKpiEntry);

router.get("/settings", getNsSettings);
router.put("/settings", updateNsSettings);

router.get("/dashboard", getDashboard);
router.get("/fulfillment", getFulfillmentBrain);
router.get("/operational", getOperationalAnalysis);

router.get("/reports/eod", getEodBrief);
router.get("/reports/weekly", getWeeklyReport);
router.get("/reports/provider-checkin", getProviderCheckIn);
router.get("/reports/provider-performance", getProviderPerformanceReview);

router.get("/analytics/weekly", getWeeklyAnalytics);
router.get("/analytics/provider-diagnostics", getProviderDiagnostics);
router.get("/analytics/monthly", getMonthlyAnalytics);

export default router;
