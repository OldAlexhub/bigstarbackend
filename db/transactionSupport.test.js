import test from "node:test";
import assert from "node:assert/strict";
import { assertTransactionSupport } from "./transactionSupport.js";

const connectionFor = (hello) => ({
  db: { admin: () => ({ command: async () => hello }) },
});

test("replica sets and sharded clusters support transactions", async () => {
  await assert.doesNotReject(() => assertTransactionSupport(connectionFor({ setName: "rs0" })));
  await assert.doesNotReject(() => assertTransactionSupport(connectionFor({ msg: "isdbgrid" })));
});

test("standalone MongoDB is rejected before startup", async () => {
  await assert.rejects(
    () => assertTransactionSupport(connectionFor({ isWritablePrimary: true })),
    /standalone MongoDB is not supported/
  );
});
