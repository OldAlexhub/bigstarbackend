import assert from "node:assert/strict";
import test from "node:test";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import Operator from "../models/Operator.js";
import Provider from "../models/Provider.js";
import RunCut from "../models/RunCut.js";
import { updatePerformanceAssignment } from "./networkSuccessSubmissionsController.js";

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
