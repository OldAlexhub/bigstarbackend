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
  user.role === "ELT" || (user.sections || []).includes(section);

export const requireSection = (section) => (req, res, next) => {
  if (canAccessSection(req.user, section)) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};

export const requireAnySection = (sections) => (req, res, next) => {
  if (req.user.role === "ELT" || sections.some((section) => (req.user.sections || []).includes(section))) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};
