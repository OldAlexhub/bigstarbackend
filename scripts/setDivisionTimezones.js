import dotenv from "dotenv";
import mongoose from "mongoose";
import connectTodb from "../db/connectTodb.js";
import Division from "../models/Division.js";
import { DEFAULT_TIMEZONE } from "../utils/timezone.js";

dotenv.config();

// Mongoose already resolves a missing `timezone` field to DEFAULT_TIMEZONE
// on read (schema default), so this is a one-off to make that explicit in
// the stored documents (so raw/.lean() reads see it too) rather than a
// functional requirement. Every division starts on the default — after
// this runs, set each division's real timezone via Settings.
const run = async () => {
  await connectTodb();

  const result = await Division.updateMany(
    { timezone: { $exists: false } },
    { $set: { timezone: DEFAULT_TIMEZONE } }
  );
  console.log(`Set timezone="${DEFAULT_TIMEZONE}" on ${result.modifiedCount} division(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
