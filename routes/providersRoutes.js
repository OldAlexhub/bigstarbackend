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

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listProviders);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), createProvider);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateProvider);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), deleteProvider);

export default router;
