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

router.use(protect, requireAnySection(["master_run_cuts", "deployment"]));

router.get("/", listOperators);
router.post("/", createOperator);
router.patch("/:id", updateOperator);
router.delete("/:id", deleteOperator);

export default router;
