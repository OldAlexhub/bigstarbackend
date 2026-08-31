import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000,
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const user = await User.findOne({ username: username.toLowerCase().trim() });
  if (!user) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  if (!user.active) {
    return res.status(403).json({ message: "This account has been deactivated." });
  }

  const token = signToken(user);
  res.cookie("token", token, cookieOptions);
  res.json({ user: user.toPublicJSON() });
};

export const logout = (req, res) => {
  res.clearCookie("token", { ...cookieOptions, maxAge: undefined });
  res.json({ message: "Logged out" });
};

export const me = (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
};
