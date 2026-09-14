import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const getRequestToken = (req) => {
  const authorization = req.get?.("authorization") || req.headers?.authorization || "";
  const bearer = typeof authorization === "string"
    ? authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    : null;

  // Prefer the explicit header so a newly issued token is not shadowed by an
  // expired cookie that a browser has retained.
  return bearer || req.cookies?.token || null;
};

export const protect = async (req, res, next) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authenticated" });
  }
};
