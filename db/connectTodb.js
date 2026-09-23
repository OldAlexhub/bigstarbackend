import mongoose from "mongoose";

mongoose.set("transactionAsyncLocalStorage", true);

const connectToDb = async (mongoUrl = process.env.MONGO_URL) => {
  if (!mongoUrl?.trim()) throw new Error("MONGO_URL is required.");

  const connection = await mongoose.connect(mongoUrl);
  console.log("MongoDB connected.");
  return connection.connection;
};

export default connectToDb;
