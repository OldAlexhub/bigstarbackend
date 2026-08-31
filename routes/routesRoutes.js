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

router.use(protect, requireAnySection(["master_run_cuts", "deployment", "network_success"]));

router.get("/", listRoutes);
router.post("/", createRoute);
router.patch("/:id", updateRoute);
router.delete("/:id", deleteRoute);

export default router;
