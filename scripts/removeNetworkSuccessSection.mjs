import dotenv from "dotenv";
import mongoose from "mongoose";
import connectTodb from "../db/connectTodb.js";
import User from "../models/User.js";

dotenv.config();

// One-off: strips "network_success" from every user's sections array before
// the enum stops allowing it, so no existing document fails validation on
// its next save.
const run = async () => {
  await connectTodb();

  const result = await User.updateMany(
    { sections: "network_success" },
    { $pull: { sections: "network_success" } }
  );
  console.log(`Removed "network_success" from ${result.modifiedCount} user(s)' sections.`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
