import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ASSETS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "email-templates"
);

const CATEGORIES = [
  { slug: "general", label: "General" },
  { slug: "reliability-profitability", label: "Reliability & Profitability" },
];

const titleCase = (filename) =>
  filename
    .replace(/\.oft$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Filenames are the on-disk source of truth; IDs are derived so the download
// route never takes a raw filename from the client (no path traversal risk).
const buildManifest = () => {
  const templates = [];
  for (const category of CATEGORIES) {
    const dir = path.join(ASSETS_DIR, category.slug);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      if (!filename.toLowerCase().endsWith(".oft")) continue;
      const filePath = path.join(dir, filename);
      const stat = fs.statSync(filePath);
      templates.push({
        id: `${category.slug}::${filename}`,
        name: titleCase(filename),
        filename,
        category: category.label,
        categorySlug: category.slug,
        sizeBytes: stat.size,
        filePath,
      });
    }
  }
  return templates;
};

export const listEmailTemplates = (req, res) => {
  const templates = buildManifest().map(({ filePath, ...rest }) => rest);
  templates.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  res.json({ templates });
};

export const downloadEmailTemplate = (req, res) => {
  const { id } = req.params;
  const template = buildManifest().find((t) => t.id === id);
  if (!template) return res.status(404).json({ message: "Template not found" });

  res.setHeader("Content-Type", "application/vnd.ms-outlook");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${template.filename}"; filename*=UTF-8''${encodeURIComponent(template.filename)}`
  );
  res.sendFile(template.filePath);
};
