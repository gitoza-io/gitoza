import { filePath2Breadcrumb } from "./breadcrumb";
import { saveBytesWithDialog, saveTextWithDialog } from "./saveWithDialog";
import { exportPathInfo } from "./exportPrintCommon";
import { exportRunsPdf as exportRunsPdfBytes } from "../services/api";
import {
  buildExportHierarchy,
  compareCasesByTreePath,
  toExportTocPayload,
} from "./exportHierarchy";
import { joinRequirementIds, normalizeRequirementIds } from "./requirementIds";

function escapeCsvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(",")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizePriority(priority) {
  const key = String(priority || "").trim().toLowerCase();
  if (key === "high" || key === "medium" || key === "low") return key;
  return "";
}

function serializeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag ?? "").trim())
      .filter((tag) => tag.length > 0)
      .join(", ");
  }
  if (typeof tags === "string") return tags.trim();
  return "";
}

function flattenRuns(runExports) {
  const rows = [];
  for (const runExport of runExports || []) {
    const run = runExport?.run ?? {};
    const cases = runExport?.cases ?? [];
    for (const c of cases) {
      const { suiteLabel, breadcrumbLabel } = exportPathInfo(c.file_path || "");
      rows.push({
        run_id: run.run_id || "",
        run_name: run.name || "",
        approve_status: run.approve_status || "",
        suite_path: suiteLabel,
        location: breadcrumbLabel,
        case_id: c.case_id || "",
        title: c.title || "",
        result: c.result || "pending",
        priority: normalizePriority(c.priority),
        requirement_id: joinRequirementIds(normalizeRequirementIds(c)),
        tags: serializeTags(c.tags),
        case_body: c.body || "",
      });
    }
  }
  return rows;
}

export async function exportRunsAsCsv(runExports, filename = "test-runs-export.csv") {
  const columns = [
    "run_id",
    "run_name",
    "approve_status",
    "suite_path",
    "location",
    "case_id",
    "title",
    "result",
    "priority",
    "requirement_id",
    "tags",
    "case_body",
  ];
  const rows = flattenRuns(runExports).sort((a, b) => {
    const runCmp = a.run_name.localeCompare(b.run_name, undefined, { sensitivity: "base" });
    if (runCmp !== 0) return runCmp;
    const suiteCmp = a.suite_path.localeCompare(b.suite_path, undefined, { sensitivity: "base" });
    if (suiteCmp !== 0) return suiteCmp;
    return a.case_id.localeCompare(b.case_id, undefined, { sensitivity: "base" });
  });
  const header = columns.map(escapeCsvCell).join(",");
  const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col] ?? "")).join(","));
  return saveTextWithDialog([header, ...lines].join("\r\n"), filename);
}

const compareByTreePath = compareCasesByTreePath;

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

function normalizeRunResult(result) {
  const value = String(result || "").trim().toLowerCase();
  if (value === "pass" || value === "passed") return "passed";
  if (value === "fail" || value === "failed") return "failed";
  if (value === "skip" || value === "skipped") return "skipped";
  return "pending";
}

function casePathLabel(filePath) {
  const segs = filePath2Breadcrumb(filePath);
  return segs.length > 0 ? segs.join(" > ") : "";
}

function toTypstRunCase(caseDetail = {}) {
  const tags = Array.isArray(caseDetail?.tags)
    ? caseDetail.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  return {
    title: String(caseDetail?.title || "Untitled Test Case"),
    case_id: String(caseDetail?.case_id || "UNSPECIFIED"),
    result: normalizeRunResult(caseDetail?.result),
    priority: String(caseDetail?.priority || "high"),
    status: String(caseDetail?.status || ""),
    path: casePathLabel(caseDetail?.file_path || ""),
    requirement_id: joinRequirementIds(normalizeRequirementIds(caseDetail)),
    tags: tags.map((name) => ({ name, tone: inferTagTone(name) })),
    body: String(caseDetail?.body || ""),
  };
}

function normalizeRunStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "in_progress") return "in_progress";
  if (value === "passed") return "passed";
  if (value === "failed") return "failed";
  return "not_started";
}

function toTypstRun(runExport = {}) {
  const run = runExport?.run ?? {};
  const sortedCases = [...(runExport?.cases ?? [])].sort(compareByTreePath);
  const cases = sortedCases.map(toTypstRunCase);
  const toc = toExportTocPayload(buildExportHierarchy(sortedCases, { forRunExport: true }));

  const totalCases = Number(run?.total_cases ?? cases.length);
  const passed = Number(run?.passed ?? 0);
  const failed = Number(run?.failed ?? 0);
  const skipped = Number(run?.skipped ?? 0);

  return {
    run_id: String(run?.run_id || ""),
    title: String(run?.name || run?.title || "Unnamed run"),
    description: String(run?.description || ""),
    status: normalizeRunStatus(run?.status),
    total_cases: Number.isFinite(totalCases) ? totalCases : cases.length,
    passed: Number.isFinite(passed) ? passed : 0,
    failed: Number.isFinite(failed) ? failed : 0,
    skipped: Number.isFinite(skipped) ? skipped : 0,
    cases,
    toc,
  };
}

export async function exportRunsAsPdf(runExports, filename = "test-runs-export.pdf", repoSlug = null) {
  if (!Array.isArray(runExports) || runExports.length === 0) return false;
  const payloadRuns = runExports.map(toTypstRun);
  const bytes = await exportRunsPdfBytes(payloadRuns, repoSlug);
  if (!bytes || bytes.length === 0) {
    throw new Error("PDF export returned an empty buffer.");
  }
  return saveBytesWithDialog(bytes, filename, "application/pdf");
}
