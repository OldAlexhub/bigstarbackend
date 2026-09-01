import PDFDocument from "pdfkit";
import Division from "../models/Division.js";
import { divisionFilter } from "../middleware/access.js";
import { buildTrackerRows } from "../utils/kpi/trackerRows.js";
import { routeDailyData } from "../utils/kpi/rankings.js";
import { getEffectiveKpiSettings } from "../utils/kpi/settings.js";
import { rankOperatorsAcrossDivisions } from "../utils/kpi/operatorLeaderboard.js";
import { pdfPageLeft, drawPdfTable } from "../utils/pdfTable.js";

const TOP_N = 20;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const fmtPct = (v) => (v == null ? "" : `${Math.round(v * 100)}%`);

// Every division the requesting user can see, each division's tracker rows
// (already closure-aware via buildTrackerRows/scheduleGaps.js) tagged with
// that division's own name so the operator rollup can display which
// division(s) each operator worked in, then ranked company-wide using one
// uniform yardstick (company-wide NSSettings, not each division's own
// override) so operators from different divisions are compared fairly.
const computeLeaderboard = async (req, from, to) => {
  const divisions = await Division.find({ ...divisionFilter(req.user), active: true }).sort({ code: 1 });
  const kpiSettings = await getEffectiveKpiSettings(null);

  const perDivisionRows = await Promise.all(
    divisions.map(async (division) => {
      const rows = await buildTrackerRows(division._id, from, to);
      return routeDailyData(rows).map((r) => ({ ...r, division: division.name }));
    })
  );

  const allRows = perDivisionRows.flat();
  const ranked = rankOperatorsAcrossDivisions(allRows, kpiSettings);
  return ranked.slice(0, TOP_N);
};

const resolveRange = (query) => {
  const { from, to } = query;
  if (!from || !to) return { error: "from and to are required" };
  return { from: new Date(from), to: new Date(to) };
};

export const getLeaderboard = async (req, res) => {
  const { error, from, to } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const top = await computeLeaderboard(req, from, to);
  res.json({ from: iso(from), to: iso(to), operators: top });
};

export const exportLeaderboardPdf = async (req, res) => {
  const { error, from, to } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const top = await computeLeaderboard(req, from, to);
  const filenameBase = `Leaderboard-${iso(from)}-to-${iso(to)}`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  const doc = new PDFDocument({ margin: 40, size: "letter" });
  doc.pipe(res);

  doc.fontSize(18).text("Operator Leaderboard", { align: "left" });
  doc.fontSize(11).fillColor("#666").text(`Top ${TOP_N} operators company-wide — ${iso(from)} to ${iso(to)}`);
  doc.moveDown();

  const pageLeft = pdfPageLeft(doc);
  const headers = ["Rank", "Operator", "Division(s)", "Provider", "OTP", "SHF", "TPSH", "Closures", "Late 1st", "Late Dep", "Score"];
  const tableRows = top.map((r) => [
    r.rank,
    r.operator,
    r.divisions,
    r.provider,
    fmtPct(r.avgOtp),
    fmtPct(r.avgShf),
    r.avgTpsh ?? "",
    r.avgRouteClosures ?? "",
    r.avgLateFirst ?? "",
    r.avgLateDeploy ?? "",
    fmtPct(r.composite),
  ]);
  drawPdfTable(doc, pageLeft, "Top Operators", headers, tableRows, [25, 85, 60, 85, 35, 35, 35, 42, 42, 42, 46]);

  doc.end();
};
