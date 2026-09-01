import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from "../controllers/vehiclesController.js";

const router = Router();

router.use(protect, requireAnySection(["master_run_cuts", "deployment"]));

router.get("/", listVehicles);
router.post("/", createVehicle);
router.patch("/:id", updateVehicle);
router.delete("/:id", deleteVehicle);

export default router;
