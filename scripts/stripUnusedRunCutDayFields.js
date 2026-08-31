import dotenv from "dotenv";
import mongoose from "mongoose";
import connectTodb from "../db/connectTodb.js";
import RunCutDay from "../models/RunCutDay.js";

dotenv.config();

// `notes` and `firstPickupOnTime` were removed from the schema (confirmed
// unused anywhere in server/ or client/src) — Mongoose stops reading/writing
// them going forward, but MongoDB is schemaless, so existing documents keep
// the stored fields until explicitly unset. One-off cleanup to reclaim that
// space on documents that already exist.
const run = async () => {
  await connectTodb();

  const result = await RunCutDay.collection.updateMany(
    { $or: [{ notes: { $exists: true } }, { firstPickupOnTime: { $exists: true } }] },
    { $unset: { notes: "", firstPickupOnTime: "" } }
  );
  console.log(`Stripped notes/firstPickupOnTime from ${result.modifiedCount} RunCutDay document(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
