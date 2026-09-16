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
