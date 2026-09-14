import assert from "node:assert/strict";
import test from "node:test";
import Settings from "./Settings.js";

test("OSR advance days defaults to the seven-day policy limit", () => {
  const settings = new Settings();
  assert.equal(settings.osrAdvanceDays, 7);
});

test("OSR advance days accepts only values from zero through seven", async () => {
  await new Settings({ osrAdvanceDays: 0 }).validate();
  await new Settings({ osrAdvanceDays: 7 }).validate();
  await assert.rejects(new Settings({ osrAdvanceDays: 2.5 }).validate(), /whole number/);
  await assert.rejects(new Settings({ osrAdvanceDays: 8 }).validate(), /maximum allowed value/);
  await assert.rejects(new Settings({ osrAdvanceDays: -1 }).validate(), /minimum allowed value/);
});
