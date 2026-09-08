import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { syncAutoIssuesBulk } from "./autoIssueSync.js";

test("live-day client notes are copied to status and disruption issue rows", async () => {
  const originalBulkWrite = DailyIssueLog.bulkWrite;
  let operations;
  DailyIssueLog.bulkWrite = async (received) => {
    operations = received;
  };

  try {
    const runCutDay = {
      _id: new mongoose.Types.ObjectId(),
      division: new mongoose.Types.ObjectId(),
      route: new mongoose.Types.ObjectId(),
      operator: new mongoose.Types.ObjectId(),
      date: new Date("2026-09-08T00:00:00.000Z"),
      status: "suspended",
      clientNotes: "Client-facing explanation",
      disruptionType: "Vehicle Breakdown",
      disruptionNotes: "Mechanical detail",
    };

    await syncAutoIssuesBulk([runCutDay], new mongoose.Types.ObjectId());

    assert.equal(operations.length, 2);
    assert.equal(
      operations[0].updateOne.update.$set.notes,
      "Client-facing explanation — Mechanical detail"
    );
    assert.equal(
      operations[1].updateOne.update.$set.notes,
      "Client-facing explanation — Mechanical detail"
    );
    assert.equal(operations[0].updateOne.update.$set.disruptionType, "Unperformed Duty");
    assert.equal(operations[1].updateOne.update.$set.disruptionType, "Vehicle Breakdown");
  } finally {
    DailyIssueLog.bulkWrite = originalBulkWrite;
  }
});

test("duplicate live-day note text is not repeated", async () => {
  const originalBulkWrite = DailyIssueLog.bulkWrite;
  let operations;
  DailyIssueLog.bulkWrite = async (received) => {
    operations = received;
  };

  try {
    await syncAutoIssuesBulk(
      [
        {
          _id: new mongoose.Types.ObjectId(),
          division: new mongoose.Types.ObjectId(),
          route: new mongoose.Types.ObjectId(),
          date: new Date("2026-09-08T00:00:00.000Z"),
          status: "active",
          clientNotes: "Same note",
          disruptionType: "Late Deploy",
          disruptionNotes: "Same note",
        },
      ],
      new mongoose.Types.ObjectId()
    );

    assert.equal(operations[1].updateOne.update.$set.notes, "Same note");
  } finally {
    DailyIssueLog.bulkWrite = originalBulkWrite;
  }
});

test("an off live-day status is logged as a route closure", async () => {
  const originalBulkWrite = DailyIssueLog.bulkWrite;
  let operations;
  DailyIssueLog.bulkWrite = async (received) => {
    operations = received;
  };

  try {
    await syncAutoIssuesBulk(
      [
        {
          _id: new mongoose.Types.ObjectId(),
          division: new mongoose.Types.ObjectId(),
          route: new mongoose.Types.ObjectId(),
          date: new Date("2026-09-08T00:00:00.000Z"),
          status: "off",
          clientNotes: "Closed at the client's request",
          disruptionType: null,
          disruptionNotes: "",
        },
      ],
      new mongoose.Types.ObjectId()
    );

    assert.equal(operations[0].updateOne.update.$set.disruptionType, "Route Closed");
    assert.equal(operations[0].updateOne.update.$set.notes, "Closed at the client's request");
    assert.equal(operations[1].deleteOne.filter.autoSyncTag, "disruption_dropdown");
  } finally {
    DailyIssueLog.bulkWrite = originalBulkWrite;
  }
});
