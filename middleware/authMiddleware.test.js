import assert from "node:assert/strict";
import test from "node:test";
import { getRequestToken } from "./authMiddleware.js";

test("authentication accepts a bearer token when a browser does not send cookies", () => {
  assert.equal(
    getRequestToken({ headers: { authorization: "Bearer header-token" }, cookies: {} }),
    "header-token"
  );
});

test("authentication retains cookie support and prefers a fresh bearer token", () => {
  assert.equal(getRequestToken({ headers: {}, cookies: { token: "cookie-token" } }), "cookie-token");
  assert.equal(
    getRequestToken({
      headers: { authorization: "bearer fresh-token" },
      cookies: { token: "stale-token" },
    }),
    "fresh-token"
  );
});

test("authentication ignores unsupported authorization schemes", () => {
  assert.equal(getRequestToken({ headers: { authorization: "Basic abc" }, cookies: {} }), null);
});
