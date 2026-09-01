import mongoose from "mongoose";
import bcrypt from "bcrypt";

export const SECTIONS = ["master_run_cuts", "deployment"];

// "ELT" is the only role that bypasses section/division checks everywhere
// in the app (see requireELT/canAccessDivision/divisionFilter in
// middleware/access.js) — the rest of the hierarchy is informational plus
// the basis for sections/divisionAccess, same as "staff" behaved before.
export const ROLES = ["ELT", "VP", "Director", "Sr Manager", "Manager", "Coordinator"];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    department: {
      type: String,
      trim: true,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ROLES,
      default: "Coordinator",
    },
    sections: {
      type: [String],
      enum: SECTIONS,
      default: [],
    },
    divisionAccess: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Division",
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    username: this.username,
    name: this.name,
    email: this.email,
    phone: this.phone,
    title: this.title,
    department: this.department,
    active: this.active,
    role: this.role,
    sections: this.sections,
    divisionAccess: this.divisionAccess,
  };
};

const User = mongoose.model("User", userSchema);

export default User;
