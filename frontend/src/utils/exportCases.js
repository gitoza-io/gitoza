/**
 * Export test cases as CSV or Typst PDF.
 */

import { filePath2Breadcrumb } from "./breadcrumb";
import { exportCasesPdf as exportCasesPdfBytes } from "../services/api";
import { saveBytesWithDialog, saveTextWithDialog } from "./saveWithDialog";
import {
  buildExportHierarchy,
  compareCasesByTreePath,
  toExportTocPayload,
} from "./exportHierarchy";
import { joinRequirementIds, normalizeRequirementIds } from "./requirementIds";

/**
 * CSV columns: project name (first segment) and suite path under project (no project prefix, no YAML/case filename), slash-separated.
 * @param {string} [filePath]
 * @returns {{ export_project: string; suite_path: string }}
 */
function exportCaseCsvPathFromFilePath(filePath) {
  const segs = filePath2Breadcrumb(filePath);
  if (segs.length === 0) return { export_project: "", suite_path: "" };
  const export_project = segs[0];
  const suite_path = segs.length > 1 ? segs.slice(1, -1).join("/") : "";
  return { export_project, suite_path };
}

/**
 * Escape a CSV cell (quotes and newlines).
 * @param {string} value
 * @returns {string}
 */
function escapeCsvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(",")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const compareByTreePath = compareCasesByTreePath;

/**
 * Normalize a case object once for all export formats.
 * Keeps raw metadata fields and adds shared derived fields (e.g. path label).
 * @param {object} caseDetail
 * @returns {{
 *   file_path: string;
 *   title: string;
 *   case_id: string;
 *   priority: string;
 *   status: string;
 *   approve_status: string;
 *   tags: string[];
 *   path: string;
 *   requirement_id: string;
 *   body: string;
 * }}
 */
function normalizeExportCase(caseDetail = {}) {
  const filePath = caseDetail?.file_path != null ? String(caseDetail.file_path) : "";
  const requirementId = joinRequirementIds(normalizeRequirementIds(caseDetail));

  const tags = Array.isArray(caseDetail?.tags)
    ? caseDetail.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];

  return {
    file_path: filePath,
    title: caseDetail?.title != null ? String(caseDetail.title) : "",
    case_id: caseDetail?.case_id != null ? String(caseDetail.case_id) : "",
    priority: caseDetail?.priority != null ? String(caseDetail.priority) : "",
    status: caseDetail?.status != null ? String(caseDetail.status) : "",
    approve_status: caseDetail?.approve_status != null ? String(caseDetail.approve_status) : "",
    tags,
    path: caseExportPathLabel(filePath),
    requirement_id: requirementId,
    automated: Boolean(caseDetail?.automated),
    body: caseDetail?.body != null ? String(caseDetail.body) : "",
  };
}

/**
 * Build CSV string from cases. Includes export_project, suite_path (folders only, under project), and file_path.
 * @param {Array<{ file_path?: string; case_id?: string; title?: string; priority?: string; status?: string; tags?: string[]; requirement_id?: string; body?: string }>} cases
 * @returns {string}
 */
export function buildCsvFromCases(cases) {
  const columns = [
    "export_project",
    "suite_path",
    "file_path",
    "case_id",
    "title",
    "priority",
    "status",
    "tags",
    "requirement_id",
    "automated",
    "body",
  ];
  const header = columns.map(escapeCsvCell).join(",");
  const normalizedCases = (Array.isArray(cases) ? cases : []).map(normalizeExportCase);
  const rows = [...normalizedCases].sort(compareByTreePath);
  const lines = rows.map((c) => {
    const tagsStr = Array.isArray(c.tags) ? c.tags.join("; ") : (c.tags ?? "");
    const { export_project, suite_path } = exportCaseCsvPathFromFilePath(c.file_path || "");
    const values = {
      export_project,
      suite_path,
      file_path: c.file_path ?? "",
      case_id: c.case_id ?? "",
      title: c.title ?? "",
      priority: c.priority ?? "",
      status: c.status ?? "",
      tags: tagsStr,
      requirement_id: c.requirement_id ?? "",
      automated: c.automated ? "true" : "",
      body: c.body ?? "",
    };
    return columns.map((col) => escapeCsvCell(values[col])).join(",");
  });
  return [header, ...lines].join("\r\n");
}

/**
 * Export cases as CSV and prompt for save location (desktop) or download (web).
 * @param {Array<object>} cases - Full case objects (file_path, case_id, title, priority, status, tags, requirement_id, body)
 * @param {string} [filename] - e.g. "test-cases-export.csv"
 * @returns {Promise<boolean>} true if saved, false if cancelled
 */
export async function exportCasesAsCsv(cases, filename = "test-cases-export.csv") {
  const csv = buildCsvFromCases(cases);
  return saveTextWithDialog(csv, filename);
}

function inferTagTone(tag) {
  const value = String(tag || "").trim().toLowerCase();
  if (!value) return "blue";
  if (value.includes("manual")) return "green";
  if (value.includes("repo")) return "purple";
  if (value.includes("tree")) return "blue";
  if (value.includes("critical") || value.includes("blocker")) return "red";
  if (value.includes("smoke") || value.includes("sanity")) return "orange";
  return "blue";
}

/** Breadcrumb label aligned with `CaseBreadcrumb` / `filePath2Breadcrumb` (segments joined by ` > `). */
function caseExportPathLabel(filePath) {
  const segs = filePath2Breadcrumb(filePath);
  return segs.length ? segs.join(" > ") : "";
}

function toTypstCase(caseDetail) {
  const normalized = normalizeExportCase(caseDetail);
  const tags = normalized.tags.map((name) => ({ name, tone: inferTagTone(name) }));

  return {
    title: normalized.title || "Untitled Test Case",
    case_id: normalized.case_id || "UNSPECIFIED",
    status: normalized.approve_status || normalized.status || "approved",
    priority: normalized.priority || "high",
    path: normalized.path,
    requirement_id: normalized.requirement_id,
    tags,
    body: normalized.body,
  };
}

/**
 * Export selected cases as Typst PDF via backend IPC.
 * @param {Array<object>} cases
 * @param {string} [filename]
 * @returns {Promise<boolean>} true if saved, false if cancelled
 */
export async function exportCasesAsPdf(cases, filename = "test-cases-export.pdf", repoSlug = null) {
  if (!Array.isArray(cases) || cases.length === 0) return false;
  const sortedNormalized = [...cases].map(normalizeExportCase).sort(compareByTreePath);
  const payloadCases = sortedNormalized.map(toTypstCase);
  const toc = toExportTocPayload(buildExportHierarchy(sortedNormalized));
  const bytes = await exportCasesPdfBytes({ cases: payloadCases, toc }, repoSlug);
  if (!bytes || bytes.length === 0) {
    throw new Error("PDF export returned an empty buffer.");
  }
  return saveBytesWithDialog(bytes, filename, "application/pdf");
}
