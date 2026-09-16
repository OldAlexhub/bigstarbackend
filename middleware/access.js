import { canAccessAnyPage, canAccessPage, canAccessPageSection } from "../utils/pageAccess.js";

export const requireELT = (req, res, next) => {
  if (req.user.role !== "ELT") {
    return res.status(403).json({ message: "ELT access required" });
  }
  next();
};

export const canAccessDivision = (user, divisionId) => {
  if (!divisionId) return false;
  if (user.role === "ELT") return true;
  return user.divisionAccess.some((id) => id.toString() === divisionId.toString());
};

export const divisionFilter = (user) => {
  if (user.role === "ELT") return {};
  return { _id: { $in: user.divisionAccess } };
};

export const canAccessSection = (user, section) =>
  canAccessPageSection(user, section);

export { canAccessPage };

export const requirePageAccess = (page) => (req, res, next) => {
  if (canAccessPage(req.user, page)) return next();
  return res.status(403).json({ message: "Access to this page is required" });
};

export const requireAnyPageAccess = (pages) => (req, res, next) => {
  if (canAccessAnyPage(req.user, pages)) return next();
  return res.status(403).json({ message: "Access to this page is required" });
};

export const requireSection = (section) => (req, res, next) => {
  if (canAccessSection(req.user, section)) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};

export const requireAnySection = (sections) => (req, res, next) => {
  if (sections.some((section) => canAccessSection(req.user, section))) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};
