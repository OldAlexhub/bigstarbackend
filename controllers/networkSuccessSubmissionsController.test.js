import assert from "node:assert/strict";
import test from "node:test";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import NetworkSubmission from "../models/NetworkSubmission.js";
import Operator from "../models/Operator.js";
import Provider from "../models/Provider.js";
import RunCut from "../models/RunCut.js";
import { removeSubmission, reopenSubmission, updatePerformanceAssignment } from "./networkSuccessSubmissionsController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("reusable Network Success corrections update Master Run Cuts and the operator directory", async () => {
  const originals = {
    findEntry: NetworkKpiEntry.findById,
    findOperator: Operator.findById,
    findProvider: Provider.findById,
    findRunCut: RunCut.findOne,
  };
  const entry = {
    _id: "entry-1",
    division: "division-1",
    route: "route-1",
    assignmentOverride: null,
    assignmentAudit: [],
    async save() {},
  };
  const operator = { _id: "operator-1", name: "Correct Operator", provider: null, async save() {} };
  const runCut = { operator: null, async save() {} };
  NetworkKpiEntry.findById = async () => entry;
  Operator.findById = () => ({ populate: async () => operator });
  Provider.findById = async () => ({ _id: "provider-1", name: "Correct Provider" });
  RunCut.findOne = async () => runCut;
  try {
    const res = response();
    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { operatorId: "operator-1", providerId: "provider-1", reuseAssignment: true },
      },
      res
    );
    assert.equal(String(runCut.operator), "operator-1");
    assert.equal(String(operator.provider), "provider-1");
    assert.equal(entry.assignmentOverride, null);
    assert.equal(entry.assignmentAudit[0].scope, "master_run_cuts");
    assert.equal(res.body.reused, true);
  } finally {
    NetworkKpiEntry.findById = originals.findEntry;
    Operator.findById = originals.findOperator;
    Provider.findById = originals.findProvider;
    RunCut.findOne = originals.findRunCut;
  }
});

test("Network Success assignment corrections are stored separately and audited", async () => {
  const originals = {
    findEntry: NetworkKpiEntry.findById,
    findOperator: Operator.findById,
    findProvider: Provider.findById,
  };
  const entry = {
    _id: "entry-1",
    division: "division-1",
    assignmentOverride: null,
    assignmentAudit: [],
    async save() {},
  };
  NetworkKpiEntry.findById = async () => entry;
  Operator.findById = () => ({ populate: async () => ({ _id: "operator-1", name: "Correct Operator", provider: null }) });
  Provider.findById = async () => ({ _id: "provider-1", name: "Correct Provider" });
  try {
    const res = response();
    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { operatorId: "operator-1", providerId: "provider-1" },
      },
      res
    );
    assert.equal(entry.assignmentOverride.operatorName, "Correct Operator");
    assert.equal(entry.assignmentOverride.providerName, "Correct Provider");
    assert.equal(entry.assignmentAudit.length, 1);
    assert.equal(entry.assignmentAudit[0].before, null);

    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { useMasterRunCut: true },
      },
      response()
    );
    assert.equal(entry.assignmentOverride, null);
    assert.equal(entry.assignmentAudit.length, 2);
  } finally {
    NetworkKpiEntry.findById = originals.findEntry;
    Operator.findById = originals.findOperator;
    Provider.findById = originals.findProvider;
  }
});

test("removing a confirmed submission deletes only its active entries and retains an audit", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findEntries: NetworkKpiEntry.find,
    deleteEntries: NetworkKpiEntry.deleteMany,
  };
  const submission = {
    _id: "submission-1",
    status: "confirmed",
    division: "division-1",
    createdBy: "user-1",
    parsedRows: [{ id: "raw" }],
    previewRows: [{ id: "preview" }],
    changeAudit: [],
    async save() {},
  };
  const entries = [{ _id: "entry-1", submission: "submission-1", date: "2026-09-08" }];
  let deleteFilter = null;
  NetworkSubmission.findById = async () => submission;
  NetworkKpiEntry.find = () => ({ lean: async () => entries });
  NetworkKpiEntry.deleteMany = async (filter) => { deleteFilter = filter; return { deletedCount: 1 }; };
  try {
    const res = response();
    await removeSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-1" },
      },
      res
    );
    assert.deepEqual(deleteFilter, { submission: "submission-1" });
    assert.equal(submission.status, "removed");
    assert.equal(submission.changeAudit[0].action, "submission_removed");
    assert.equal(submission.changeAudit[0].removedEntries.length, 1);
    assert.deepEqual(submission.parsedRows, []);
    assert.deepEqual(submission.previewRows, []);
    assert.equal(res.body.removedEntries, 1);
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    NetworkKpiEntry.find = originals.findEntries;
    NetworkKpiEntry.deleteMany = originals.deleteEntries;
  }
});

test("opening a confirmed submission creates one editable revision and preserves the original", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findRevision: NetworkSubmission.findOne,
    createSubmission: NetworkSubmission.create,
  };
  const original = {
    _id: "submission-1",
    source: "vision",
    status: "confirmed",
    division: "division-1",
    createdBy: "user-1",
    files: [{ kind: "vision", name: "report.xlsx", size: 100, sha256: "hash" }],
    divisionCandidates: [{ division: "division-1" }],
    parsedRows: [{ id: "row-1", sourceRoute: "1001" }],
    blockedDates: [],
    reportDates: ["2026-09-08"],
    warnings: [],
    counts: { sourceRows: 1, zeroTripRows: 0 },
    changeAudit: [],
    async save() {},
  };
  let createdPayload = null;
  NetworkSubmission.findById = async () => original;
  NetworkSubmission.findOne = async () => null;
  NetworkSubmission.create = async (payload) => {
    createdPayload = payload;
    return { _id: "revision-1", ...payload };
  };
  try {
    const res = response();
    await reopenSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-1" },
      },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.submission.id, "revision-1");
    assert.equal(createdPayload.status, "pending");
    assert.equal(createdPayload.reopenedFrom, "submission-1");
    assert.deepEqual(createdPayload.parsedRows, original.parsedRows);
    assert.equal(original.status, "confirmed");
    assert.equal(original.changeAudit[0].action, "reopened_as_revision");
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    NetworkSubmission.findOne = originals.findRevision;
    NetworkSubmission.create = originals.createSubmission;
  }
});
