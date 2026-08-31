import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import { listEmailTemplates, downloadEmailTemplate } from "../controllers/networkSuccess/emailTemplatesController.js";

const router = Router();

router.use(protect, requireSection("network_success"));

router.get("/", listEmailTemplates);
router.get("/:id/download", downloadEmailTemplate);

export default router;
