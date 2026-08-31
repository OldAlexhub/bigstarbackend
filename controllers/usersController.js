import User, { ROLES, SECTIONS } from "../models/User.js";

const duplicateMessage = (error) => {
  const field = Object.keys(error.keyPattern || {})[0] || "value";
  return `That ${field} is already in use.`;
};

const sanitizeSections = (sections) =>
  Array.isArray(sections) ? sections.filter((s) => SECTIONS.includes(s)) : undefined;

export const listUsers = async (req, res) => {
  const users = await User.find({}).populate("divisionAccess", "code name").sort({ name: 1 });
  res.json({ users: users.map((u) => u.toPublicJSON()) });
};

export const createUser = async (req, res) => {
  const { username, password, name, email, phone, title, department, role, sections, divisionAccess } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ message: "username, password, and name are required" });
  }
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ message: `role must be one of: ${ROLES.join(", ")}` });
  }

  try {
    const user = await User.create({
      username,
      password,
      name,
      email: email || null,
      phone: phone || "",
      title: title || "",
      department: department || "",
      role: role || undefined,
      sections: sanitizeSections(sections) || [],
      divisionAccess: divisionAccess || [],
    });
    const populated = await user.populate("divisionAccess", "code name");
    res.status(201).json({ user: populated.toPublicJSON() });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: duplicateMessage(error) });
    throw error;
  }
};

export const updateUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  const { password, name, email, phone, title, department, role, sections, divisionAccess, active } = req.body;
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ message: `role must be one of: ${ROLES.join(", ")}` });
    user.role = role;
  }
  if (password) user.password = password;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email || null;
  if (phone !== undefined) user.phone = phone;
  if (title !== undefined) user.title = title;
  if (department !== undefined) user.department = department;
  if (sections !== undefined) user.sections = sanitizeSections(sections) || [];
  if (divisionAccess !== undefined) user.divisionAccess = divisionAccess;
  if (active !== undefined) {
    if (!active && user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You can't deactivate your own account." });
    }
    user.active = Boolean(active);
  }

  try {
    await user.save();
    const populated = await user.populate("divisionAccess", "code name");
    res.json({ user: populated.toPublicJSON() });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: duplicateMessage(error) });
    throw error;
  }
};

export const deleteUser = async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: "You can't delete your own account." });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  await user.deleteOne();
  res.json({ message: "User deleted" });
};
