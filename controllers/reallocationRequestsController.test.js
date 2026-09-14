import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import RunCut from "../models/RunCut.js";
import { createReallocationRequest } from "./reallocationRequestsController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const queryFor = (value) => {
  const query = {
    populate() { return query; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
};

test("a destination route must still be unassigned when the request is submitted", async () => {
  const originalFindById = RunCut.findById;
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const destinationId = new mongoose.Types.ObjectId();
  const values = [
    {
      _id: currentId,
      division,
      route: { _id: new mongoose.Types.ObjectId(), code: "101" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Alex Driver" },
      vehicle: null,
      pulloutAddress: "",
    },
    {
      _id: destinationId,
      division,
      route: { _id: new mongoose.Types.ObjectId(), code: "202" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Already Assigned" },
      vehicle: null,
      pulloutAddress: "",
    },
  ];
  RunCut.findById = () => queryFor(values.shift());

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        destinationRunCut: String(destinationId),
        effectiveDate: "2026-09-14",
        operatorName: "",
        vehicleCode: "",
        pulloutAddress: "",
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /already assigned/i);
  } finally {
    RunCut.findById = originalFindById;
  }
});

test("a blank-operator destination must also have Unassigned Master Run Cut status", async () => {
  const originalFindById = RunCut.findById;
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const destinationId = new mongoose.Types.ObjectId();
  const values = [
    {
      _id: currentId,
      division,
      status: "active",
      route: { _id: new mongoose.Types.ObjectId(), code: "101" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Alex Driver" },
      vehicle: null,
      pulloutAddress: "",
    },
    {
      _id: destinationId,
      division,
      status: "active",
      route: { _id: new mongoose.Types.ObjectId(), code: "202" },
      operator: null,
      vehicle: null,
      pulloutAddress: "",
    },
  ];
  RunCut.findById = () => queryFor(values.shift());

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        destinationRunCut: String(destinationId),
        effectiveDate: "2026-09-14",
        operatorName: "",
        vehicleCode: "",
        pulloutAddress: "",
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /marked Unassigned in Master Run Cuts/i);
  } finally {
    RunCut.findById = originalFindById;
  }
});
