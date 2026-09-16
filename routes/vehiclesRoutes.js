import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess } from "../middleware/access.js";
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from "../controllers/vehiclesController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess([
  "master_run_cuts.run_cuts",
  "master_run_cuts.vehicles",
  "deployment.live_schedule",
  "network_success.reallocation_requests",
]), listVehicles);
router.post("/", requirePageAccess("master_run_cuts.vehicles"), createVehicle);
router.patch("/:id", requirePageAccess("master_run_cuts.vehicles"), updateVehicle);
router.delete("/:id", requirePageAccess("master_run_cuts.vehicles"), deleteVehicle);

export default router;
