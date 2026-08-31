import Operator from "../models/Operator.js";

export const listOperators = async (req, res) => {
  const operators = await Operator.find().sort({ name: 1 }).populate("provider", "name");
  res.json({ operators });
};

export const createOperator = async (req, res) => {
  const { name, employeeId, provider } = req.body;
  const operator = await Operator.create({ name, employeeId, provider: provider || null });
  res.status(201).json({ operator });
};

export const updateOperator = async (req, res) => {
  const operator = await Operator.findById(req.params.id);
  if (!operator) return res.status(404).json({ message: "Operator not found" });
  const { name, employeeId, provider, active } = req.body;
  if (name !== undefined) operator.name = name;
  if (employeeId !== undefined) operator.employeeId = employeeId;
  if (provider !== undefined) operator.provider = provider || null;
  if (active !== undefined) operator.active = active;
  await operator.save();
  res.json({ operator });
};

export const deleteOperator = async (req, res) => {
  const operator = await Operator.findByIdAndDelete(req.params.id);
  if (!operator) return res.status(404).json({ message: "Operator not found" });
  res.json({ message: "Operator deleted" });
};
