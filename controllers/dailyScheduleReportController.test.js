import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import RunCutDay from "../models/RunCutDay.js";
import { getDailyScheduleReport } from "./dailyScheduleReportController.js";

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

test("disposition-only changes do not alter today's or tomorrow's client report", async () => {
  const originalFindById = Division.findById;
  const originalFind = RunCutDay.find;
  let days = [];
  Division.findById = async () => ({ _id: "division-1", code: "D1", name: "Division 1" });
  RunCutDay.find = () => {
    const query = {
      populate() {
        return this;
      },
      sort() {
        return Promise.resolve(days);
      },
    };
    return query;
  };

  try {
    for (const date of ["2026-09-09", "2026-09-10"]) {
      const baseDay = {
        _id: `day-${date}`,
        date: new Date(`${date}T00:00:00.000Z`),
        division: "division-1",
        route: { _id: "route-1", code: "R1", type: "scheduled" },
        operator: { _id: "operator-1", name: "Operator" },
        vehicle: { _id: "vehicle-1", code: "V1" },
        pulloutAddress: "Garage",
        startTime: "08:00",
        endTime: "16:00",
        status: "active",
        clientNotes: "Existing client note",
      };

      days = [{ ...baseDay, disposition: null }];
      const openResponse = responseRecorder();
      await getDailyScheduleReport(
        { user: { role: "ELT" }, query: { division: "division-1", date } },
        openResponse
      );

      days = [{ ...baseDay, disposition: "deployed_late" }];
      const closedResponse = responseRecorder();
      await getDailyScheduleReport(
        { user: { role: "ELT" }, query: { division: "division-1", date } },
        closedResponse
      );

      assert.deepEqual(closedResponse.body, openResponse.body);
    }
  } finally {
    Division.findById = originalFindById;
    RunCutDay.find = originalFind;
  }
});
