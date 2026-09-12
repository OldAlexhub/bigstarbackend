import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { runInTransaction } from "./transaction.js";

test("critical writes use snapshot reads and majority write concern", async () => {
  const original = mongoose.connection.transaction;
  let options;
  mongoose.connection.transaction = async (work, receivedOptions) => {
    options = receivedOptions;
    return work();
  };

  try {
    const result = await runInTransaction(async () => "committed");
    assert.equal(result, "committed");
    assert.deepEqual(options, {
      readPreference: "primary",
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
  } finally {
    mongoose.connection.transaction = original;
  }
});
