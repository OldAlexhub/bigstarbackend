import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import {
  createDivision,
  deleteDivision,
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

test("the legacy delete endpoint also preserves division data by retiring it", async () => {
  const originalFindById = Division.findById;
  let saved = false;
  const division = {
    active: true,
    async save() { saved = true; },
  };
  Division.findById = async () => division;

  try {
    const response = responseRecorder();
    await deleteDivision({ params: { id: "division-1" } }, response);
    assert.equal(division.active, false);
    assert.equal(saved, true);
    assert.match(response.body.message, /historical data was preserved/i);
  } finally {
    Division.findById = originalFindById;
  }
});
