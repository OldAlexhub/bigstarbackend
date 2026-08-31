import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
    },
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

vehicleSchema.index({ division: 1, code: 1 }, { unique: true });

const Vehicle = mongoose.model("Vehicle", vehicleSchema);

export default Vehicle;
