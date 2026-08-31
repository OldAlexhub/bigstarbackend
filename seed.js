import dotenv from "dotenv";
import mongoose from "mongoose";
import connectTodb from "./db/connectTodb.js";
import User, { SECTIONS } from "./models/User.js";

dotenv.config();

const run = async () => {
  await connectTodb();

  const username = "mohamedgad";
  const existing = await User.findOne({ username });

  if (existing) {
    existing.password = "12345678";
    existing.name = "Mohamed Gad";
    existing.role = "ELT";
    existing.sections = SECTIONS;
    await existing.save();
    console.log(`Updated existing user "${username}"`);
  } else {
    await User.create({
      username,
      password: "12345678",
      name: "Mohamed Gad",
      role: "ELT",
      sections: SECTIONS,
    });
    console.log(`Created user "${username}"`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
