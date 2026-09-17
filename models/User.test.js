import assert from "node:assert/strict";
import test from "node:test";
import User from "./User.js";
import { canWritePage } from "../utils/pageAccess.js";

test("page access levels safely store dotted page keys and serialize for the client", async () => {
  const user = new User({
    username: "permissions.test",
    password: "temporary-password",
    name: "Permissions Test",
    pageAccessConfigured: true,
    pageAccess: ["network_success.performance", "report_builder"],
    pageAccessLevels: [
      { page: "network_success.performance", level: "read" },
      { page: "report_builder", level: "write" },
    ],
  });

  await user.validate();
  assert.deepEqual(user.toPublicJSON().pageAccessLevels, {
    "network_success.performance": "read",
    report_builder: "write",
  });
});

test("a persisted-style read-only Master Run Cuts permission cannot write", async () => {
  const user = new User({
    username: "readonly.run.cuts",
    password: "temporary-password",
    name: "Read Only Run Cuts",
    role: "Manager",
    pageAccessConfigured: true,
    pageAccess: ["master_run_cuts.run_cuts"],
    pageAccessLevels: [{ page: "master_run_cuts.run_cuts", level: "read" }],
  });

  await user.validate();
  assert.equal(canWritePage(user, "master_run_cuts.run_cuts"), false);
});
