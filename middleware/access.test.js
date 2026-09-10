import assert from "node:assert/strict";
import test from "node:test";
import { requireSection } from "./access.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Network Success is assignable while ELT retains automatic access", () => {
  const gate = requireSection("network_success");
  let allowed = false;
  gate({ user: { role: "Coordinator", sections: ["network_success"] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  allowed = false;
  gate({ user: { role: "ELT", sections: [] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = response();
  gate({ user: { role: "Coordinator", sections: [] } }, denied, () => {});
  assert.equal(denied.statusCode, 403);
});
