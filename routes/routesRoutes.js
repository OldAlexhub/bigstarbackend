import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
} from "../controllers/routesController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listRoutes);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), createRoute);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateRoute);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), deleteRoute);

export default router;
