import mongoose from "mongoose";

mongoose.set("transactionAsyncLocalStorage", true);

export const runInTransaction = (work) =>
  mongoose.connection.transaction(work, {
    readPreference: "primary",
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
  });
