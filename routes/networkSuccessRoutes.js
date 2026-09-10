import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  confirmSubmission,
  getPerformance,
  listEntries,
  listSubmissions,
  preprocessSubmission,
  previewSubmission,
  removeSubmission,
  reopenSubmission,
  updatePerformanceAssignment,
} from "../controllers/networkSuccessSubmissionsController.js";

const router = Router();
const excelExtension = /\.xlsx?$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    if (!excelExtension.test(file.originalname)) return callback(new Error("Only .xls and .xlsx workbooks are accepted."));
    callback(null, true);
  },
});
const receiveWorkbooks = (req, res, next) => {
  upload.fields([
    { name: "vision", maxCount: 1 },
    { name: "productivity", maxCount: 1 },
    { name: "driverPerformance", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Each workbook must be 10 MB or smaller." });
    return res.status(400).json({ message: error.message || "The uploaded files could not be accepted." });
  });
};

router.use(protect, requireSection("network_success"));
router.get("/submissions", listSubmissions);
router.get("/entries", listEntries);
router.get("/performance", getPerformance);
router.delete("/submissions/:id", removeSubmission);
router.post("/submissions/:id/reopen", reopenSubmission);
router.patch("/entries/:id/assignment", updatePerformanceAssignment);
router.post("/submissions/preprocess", receiveWorkbooks, preprocessSubmission);
router.post("/submissions/:id/preview", previewSubmission);
router.post("/submissions/:id/confirm", confirmSubmission);

export default router;
