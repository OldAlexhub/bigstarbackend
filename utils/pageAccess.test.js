import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_ACCESS,
  canAccessPage,
  normalizePageAccess,
  sectionsForPageAccess,
} from "./pageAccess.js";

test("page access normalization rejects unknown pages and removes duplicates", () => {
  assert.deepEqual(
    normalizePageAccess(["dashboard", "not-a-page", "dashboard", "safety.scores"]),
    ["dashboard", "safety.scores"]
  );
  assert.equal(PAGE_ACCESS.includes("deployment.client_report"), true);
  assert.equal(PAGE_ACCESS.includes("network_success.tui_helper"), true);
  assert.equal(PAGE_ACCESS.includes("report_builder"), true);
});

test("sections are derived from the selected granular pages", () => {
  assert.deepEqual(
    sectionsForPageAccess(["dashboard", "deployment.reporting", "deployment.posts", "safety.analytics"]),
    ["deployment", "safety"]
  );
});

test("ELT always has access and explicit empty access denies non-ELT users", () => {
  assert.equal(canAccessPage({ role: "ELT", pageAccessConfigured: true, pageAccess: [] }, "leaderboard"), true);
  assert.equal(
    canAccessPage({ role: "Manager", sections: ["deployment"], pageAccessConfigured: true, pageAccess: [] }, "deployment.live_schedule"),
    false
  );
});

test("Report Builder is an independently assignable page permission", () => {
  const user = {
    role: "Manager",
    sections: [],
    pageAccessConfigured: true,
    pageAccess: ["report_builder"],
  };

  assert.equal(canAccessPage(user, "report_builder"), true);
  assert.equal(canAccessPage(user, "elt_reporting.operations_report"), false);
  assert.equal(canAccessPage(user, "leaderboard"), false);
});
