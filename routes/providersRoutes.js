import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
} from "../controllers/providersController.js";

const router = Router();

router.use(protect, requireAnySection(["master_run_cuts", "deployment"]));

router.get("/", listProviders);
router.post("/", createProvider);
router.patch("/:id", updateProvider);
router.delete("/:id", deleteProvider);

export default router;
