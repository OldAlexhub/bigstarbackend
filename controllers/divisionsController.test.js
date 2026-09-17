import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Division from "../models/Division.js";
import User from "../models/User.js";
import ChangeLog from "../models/ChangeLog.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import {
  createDivision,
  deleteDivision,
  DIVISION_OWNED_MODELS,
  listDivisions,
  updateDivision,
} from "./divisionsController.js";

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("ordinary division lists hide retired divisions while ELT Settings can include them", async () => {
  const originalFind = Division.find;
  const filters = [];
  Division.find = (filter) => {
    filters.push(filter);
    return {
      sort() { return this; },
      populate() { return Promise.resolve([]); },
    };
  };

  try {
    await listDivisions({ user: { role: "ELT" }, query: {} }, responseRecorder());
    await listDivisions(
      { user: { role: "ELT" }, query: { includeInactive: "1" } },
      responseRecorder()
    );

    assert.deepEqual(filters[0], { active: { $ne: false } });
    assert.deepEqual(filters[1], {});
  } finally {
    Division.find = originalFind;
  }
});

test("creating a division immediately seeds its default Operations KPI settings", async () => {
  const originalCreate = Division.create;
  const originalBulkWrite = OperationsKpiSetting.bulkWrite;
  const division = { _id: "division-new", code: "DIV_20", name: "Division 20", active: true };
  let operations = [];
  Division.create = async () => division;
  OperationsKpiSetting.bulkWrite = async (items) => {
    operations = items;
  };

  try {
    const response = responseRecorder();
    await createDivision(
      { body: { code: "DIV_20", name: "Division 20", timezone: "America/New_York" } },
      response
    );

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.division, division);
    assert.equal(operations.length, 9);
    assert.ok(operations.every((operation) => operation.updateOne.filter.division === "division-new"));
  } finally {
    Division.create = originalCreate;
    OperationsKpiSetting.bulkWrite = originalBulkWrite;
  }
});

test("retiring a division is an ELT-only soft change", async () => {
  const originalFindById = Division.findById;
  let saved = 0;
  const division = {
    _id: "division-1",
    active: true,
    thresholds: {},
    async save() { saved += 1; },
  };
  Division.findById = async () => division;

  try {
    const denied = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { active: false },
        user: { role: "Manager", divisionAccess: ["division-1"] },
      },
      denied
    );
    assert.equal(denied.statusCode, 403);
    assert.equal(saved, 0);

    const retired = responseRecorder();
    await updateDivision(
      { params: { id: "division-1" }, body: { active: false }, user: { role: "ELT" } },
      retired
    );
    assert.equal(retired.statusCode, 200);
    assert.equal(division.active, false);
    assert.equal(saved, 1);
  } finally {
    Division.findById = originalFindById;
  }
});

test("only ELT can rename a division", async () => {
  const originalFindById = Division.findById;
  let saved = 0;
  const division = {
    _id: "division-1",
    name: "Old Division Name",
    thresholds: {},
    async save() { saved += 1; },
  };
  Division.findById = async () => division;

  try {
    const denied = responseRecorder();
    await updateDivision({
      params: { id: "division-1" },
      body: { name: "Unauthorized Rename" },
      user: { role: "Manager", divisionAccess: ["division-1"] },
    }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(division.name, "Old Division Name");
    assert.equal(saved, 0);

    const renamed = responseRecorder();
    await updateDivision({
      params: { id: "division-1" },
      body: { name: "  Central Operations  " },
      user: { role: "ELT" },
    }, renamed);
    assert.equal(renamed.statusCode, 200);
    assert.equal(division.name, "Central Operations");
    assert.equal(saved, 1);
  } finally {
    Division.findById = originalFindById;
  }
});

test("permanently deleting a division removes its owned data and access references", async () => {
  const originalFindById = Division.findById;
  const originalDivisionDeleteOne = Division.deleteOne;
  const originalDivisionUpdateMany = Division.updateMany;
  const originalUserUpdateMany = User.updateMany;
  const originalChangeLogDeleteMany = ChangeLog.deleteMany;
  const originalOwnedDeleteMany = DIVISION_OWNED_MODELS.map((Model) => [Model, Model.deleteMany]);
  const originalTransaction = mongoose.connection.transaction;
  const deletedFilters = [];
  const division = { _id: "division-1", code: "DIV_1", active: true };
  Division.findById = async () => division;
  Division.deleteOne = async (filter) => { deletedFilters.push(["division", filter]); };
  Division.updateMany = async (filter, update) => { deletedFilters.push(["children", filter, update]); };
  User.updateMany = async (filter, update) => { deletedFilters.push(["users", filter, update]); };
  ChangeLog.deleteMany = async (filter) => { deletedFilters.push(["changes", filter]); };
  DIVISION_OWNED_MODELS.forEach((Model) => {
    Model.deleteMany = async (filter) => { deletedFilters.push([Model.modelName, filter]); };
  });
  mongoose.connection.transaction = async (work) => work();

  try {
    const rejected = responseRecorder();
    await deleteDivision({ params: { id: "division-1" }, body: {} }, rejected);
    assert.equal(rejected.statusCode, 400);
    assert.equal(deletedFilters.length, 0);

    const response = responseRecorder();
    await deleteDivision(
      { params: { id: "division-1" }, body: { confirmationCode: "DIV_1" } },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.deletedDivisionId, "division-1");
    assert.match(response.body.message, /permanently deleted/i);
    assert.equal(
      deletedFilters.filter(([kind]) => kind === "division").length,
      1
    );
    assert.equal(
      deletedFilters.filter(([, filter]) => filter?.division === "division-1").length,
      DIVISION_OWNED_MODELS.length
    );
    assert.ok(deletedFilters.some(([kind]) => kind === "users"));
    assert.ok(deletedFilters.some(([kind]) => kind === "children"));
  } finally {
    Division.findById = originalFindById;
    Division.deleteOne = originalDivisionDeleteOne;
    Division.updateMany = originalDivisionUpdateMany;
    User.updateMany = originalUserUpdateMany;
    ChangeLog.deleteMany = originalChangeLogDeleteMany;
    mongoose.connection.transaction = originalTransaction;
    originalOwnedDeleteMany.forEach(([Model, deleteMany]) => { Model.deleteMany = deleteMany; });
  }
});
