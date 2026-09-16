import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess } from "../middleware/access.js";
import {
  listOperators,
  createOperator,
  updateOperator,
  deleteOperator,
} from "../controllers/operatorsController.js";

const router = Router();

router.use(protect);

const operatorPages = [
  "master_run_cuts.run_cuts",
  "master_run_cuts.drivers",
  "deployment.live_schedule",
  "deployment.issue_log",
  "network_success.performance",
  "network_success.reallocation_requests",
];

router.get("/", requireAnyPageAccess(operatorPages), listOperators);
router.post("/", requirePageAccess("master_run_cuts.drivers"), createOperator);
router.patch("/:id", requirePageAccess("master_run_cuts.drivers"), updateOperator);
router.delete("/:id", requirePageAccess("master_run_cuts.drivers"), deleteOperator);

export default router;
