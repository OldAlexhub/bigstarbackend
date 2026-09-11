import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireSection } from "../middleware/access.js";
import {
  deleteCustomerServiceEntry,
  getCustomerServiceAnalytics,
  listCustomerServiceEntries,
  saveCustomerServiceEntry,
} from "../controllers/customerServiceController.js";

const router = Router();

router.use(protect, requireSection("customer_service"));
router.get("/entries", listCustomerServiceEntries);
router.put("/entries", saveCustomerServiceEntry);
router.delete("/entries/:id", deleteCustomerServiceEntry);
router.get("/analytics", getCustomerServiceAnalytics);

export default router;
