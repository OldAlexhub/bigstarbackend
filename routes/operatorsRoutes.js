import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnySection } from "../middleware/access.js";
import {
  listOperators,
  createOperator,
  updateOperator,
  deleteOperator,
} from "../controllers/operatorsController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnySection(["master_run_cuts", "deployment", "network_success"]), listOperators);
router.post("/", requireAnySection(["master_run_cuts", "deployment"]), createOperator);
router.patch("/:id", requireAnySection(["master_run_cuts", "deployment"]), updateOperator);
router.delete("/:id", requireAnySection(["master_run_cuts", "deployment"]), deleteOperator);

export default router;
