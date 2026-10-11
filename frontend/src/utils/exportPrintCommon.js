/**
 * Shared HTML/CSS for print/PDF exports (test cases and test runs).
 * Keeps one visual system and suite grouping logic.
 *
 * @module utils/exportPrintCommon
 */

import { filePath2Breadcrumb } from "./breadcrumb";

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Readable count phrase, e.g. pluralUnit(1, "run", "runs") → "1 run", pluralUnit(3, "case", "cases") → "3 cases".
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
export function pluralUnit(count, singular, plural) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Suite grouping key + labels (aligned with repo breadcrumb).
 * @param {string} [filePath]
 * @returns {{ key: string; suiteLabel: string; breadcrumbLabel: string }}
 */
export function exportPathInfo(filePath) {
  const segs = filePath2Breadcrumb(filePath);
  const breadcrumbLabel = segs.length ? segs.join(" > ") : "";
  if (segs.length === 0) {
    return { key: "__uncategorized__", suiteLabel: "Uncategorized", breadcrumbLabel: "" };
  }
  if (segs.length === 1) {
    return { key: "__root__", suiteLabel: "Root", breadcrumbLabel };
  }
  const folderSegs = segs.slice(0, -1);
  return {
    key: folderSegs.join("/"),
    suiteLabel: folderSegs.join(" > "),
    breadcrumbLabel,
  };
}

/**
 * @param {Array<{ file_path?: string }>} cases
 * @returns {Array<{ suiteLabel: string; cases: object[] }>}
 */
export function groupCasesBySuiteForExport(cases) {
  const map = new Map();
  for (const c of cases) {
    const info = exportPathInfo(c.file_path || "");
    if (!map.has(info.key)) {
      map.set(info.key, { suiteLabel: info.suiteLabel, cases: [] });
    }
    map.get(info.key).cases.push(c);
  }
  for (const g of map.values()) {
    g.cases.sort((a, b) => {
      const idA = (a.case_id || a.title || "").toString();
      const idB = (b.case_id || b.title || "").toString();
      return idA.localeCompare(idB, undefined, { sensitivity: "base" });
    });
  }
  return [...map.values()].sort((a, b) =>
    a.suiteLabel.localeCompare(b.suiteLabel, undefined, { sensitivity: "base" }),
  );
}

/**
 * Base print styles shared by case export and run export (case cards, suite headings, toolbar).
 * Run export appends small modifiers via {@link RUN_EXPORT_EXTRA_STYLES}.
 */
export const EXPORT_PRINT_BASE_STYLES = `
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 1rem;
      max-width: 800px;
      margin: 0 auto;
      color: #0f172a;
      background: #fff;
      line-height: 1.5;
    }
    .export-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: #f4f4f5;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 0 0 1.25rem 0;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    .export-toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .export-toolbar button {
      font: inherit;
      font-weight: 600;
      padding: 10px 18px;
      cursor: pointer;
      border: 1px solid #18181b;
      border-radius: 6px;
      background: #18181b;
      color: #fafafa;
    }
    .export-toolbar button:hover { background: #27272a; }
    .export-toolbar button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
    .export-toolbar-hint {
      margin: 0;
      flex: 1 1 200px;
      font-size: 0.8125rem;
      line-height: 1.45;
      color: #52525b;
    }
    .export-doc-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0 0 1.25rem 0;
      color: #0f172a;
    }
    .export-run-block {
      margin-bottom: 2.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .export-run-block:last-of-type { border-bottom: none; }
    .export-run-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin: 0 0 0.35rem 0;
      color: #0f172a;
    }
    .export-run-meta {
      margin: 0 0 1rem 0;
      font-size: 0.8125rem;
      color: #64748b;
      line-height: 1.45;
    }
    .export-suite-section {
      margin-bottom: 2rem;
    }
    .export-suite-heading {
      font-size: 1.05rem;
      font-weight: 700;
      color: #334155;
      margin: 0 0 0.85rem 0;
      padding-bottom: 0.35rem;
      border-bottom: 2px solid #cbd5e1;
    }
    .export-suite-section:first-of-type .export-suite-heading { margin-top: 0; }
    .export-case-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 0.75rem 1rem 1rem;
      margin-bottom: 1.5rem;
      background: #fafafa;
    }
    .export-run-case-card {
      padding-bottom: 0.75rem;
      margin-bottom: 1rem;
    }
    .export-case-header { margin-bottom: 0; }
    .export-case-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem 0.5rem;
      margin-bottom: 0.35rem;
    }
    .export-case-title {
      font-size: 1.125rem;
      font-weight: 700;
      line-height: 1.35;
      margin: 0;
      color: #0f172a;
    }
    .export-case-location {
      font-size: 0.78rem;
      line-height: 1.45;
      color: #64748b;
      margin: 0 0 0.5rem 0;
    }
    .export-location-label {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 0.65rem;
      color: #94a3b8;
      margin-right: 0.35rem;
    }
    .export-location-path { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .export-case-id-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.65rem;
    }
    .export-case-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875rem;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: #1e293b;
    }
    .export-status {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
    }
    .export-status-active {
      background: #ecfdf5;
      color: #047857;
    }
    .export-status-archived {
      background: #fef3c7;
      color: #b45309;
    }
    .export-result-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
    }
    .export-result-passed { background: #ecfdf5; color: #047857; }
    .export-result-failed { background: #fef2f2; color: #b91c1c; }
    .export-result-skipped { background: #fef3c7; color: #b45309; }
    .export-result-pending { background: #f1f5f9; color: #475569; }
    .export-case-meta {
      display: flex;
      flex-direction: column;
      gap: 0.35rem 0;
      font-size: 0.875rem;
    }
    .export-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem 0.75rem;
    }
    .export-meta-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      min-width: 4.5rem;
    }
    .export-priority { font-weight: 700; }
    .export-requirement { font-weight: 700; color: #4338ca; }
    .export-tags-row .export-meta-label { align-self: flex-start; padding-top: 0.2rem; }
    .export-tags-wrap { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
    .export-tag-pill {
      display: inline-block;
      border-radius: 9999px;
      padding: 0.2rem 0.5rem;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.3;
    }
    .export-case-divider {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 0.75rem 0 0.85rem;
    }
    .export-case-body { font-size: 0.875rem; color: #1e293b; }
    .export-md-muted { color: #94a3b8; text-align: center; padding: 1rem 0; }
    .export-md-h1 { font-size: 1.125rem; font-weight: 700; margin: 1.25rem 0 0.5rem; color: #0f172a; }
    .export-md-h2 { font-size: 1rem; font-weight: 600; margin: 1.1rem 0 0.4rem; color: #1e293b; }
    .export-md-h3 { font-size: 0.9375rem; font-weight: 600; margin: 0.9rem 0 0.35rem; color: #334155; }
    .export-md-h1:first-child, .export-md-h2:first-child, .export-md-h3:first-child { margin-top: 0; }
    .export-md-p { margin: 0.5rem 0; line-height: 1.6; }
    .export-md-hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 1.25rem 0;
    }
    .export-md-bq {
      margin: 0.65rem 0;
      padding: 0.5rem 0.75rem 0.5rem 1rem;
      border-left: 4px solid #818cf8;
      background: rgba(238, 242, 255, 0.85);
      border-radius: 0 6px 6px 0;
    }
    .export-md-bq-p { margin: 0.25rem 0; line-height: 1.55; }
    .export-md-ol, .export-md-ul-disc, .export-md-ul-circle, .export-md-ul-square, .export-md-ul {
      margin: 0.45rem 0;
      padding-left: 1.35rem;
    }
    .export-md-ol { list-style-type: decimal; }
    .export-md-ul-disc { list-style-type: disc; }
    .export-md-ul-circle { list-style-type: circle; }
    .export-md-ul-square { list-style-type: square; }
    .export-md-li { margin: 0.2rem 0; line-height: 1.55; }
    .export-md-task-ul { list-style: none; padding-left: 0; margin: 0.45rem 0; }
    .export-md-task-li {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0.35rem 0;
      line-height: 1.55;
    }
    .export-md-taskbox {
      flex-shrink: 0;
      width: 1rem;
      height: 1rem;
      margin-top: 0.15rem;
      border: 1px solid #cbd5e1;
      border-radius: 3px;
      background: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      color: #fff;
    }
    .export-md-taskbox-checked {
      background: #6366f1;
      border-color: #6366f1;
    }
    .export-md-task-done { color: #64748b; text-decoration: line-through; }
    .export-md-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8125rem;
      background: #e2e8f0;
      padding: 0.12rem 0.35rem;
      border-radius: 4px;
      color: #334155;
    }
    .export-md-pre {
      margin: 0.75rem 0;
      padding: 0.75rem 1rem;
      overflow-x: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    .export-md-pre-code {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      background: transparent;
      color: #1e293b;
    }
    .export-md-strong { font-weight: 600; }
    .export-md-em { font-style: italic; }
    .export-md-table-wrap {
      margin: 0.75rem 0;
      overflow-x: auto;
      border: 1px solid #cbd5e1;
      border-radius: 0.5rem;
    }
    .export-md-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      color: #1e293b;
    }
    .export-md-th,
    .export-md-td {
      border: 1px solid #cbd5e1;
      padding: 0.5rem 0.75rem;
      vertical-align: top;
      text-align: left;
    }
    .export-md-th {
      background: #f8fafc;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
    }
    .case-block { page-break-after: auto; }
    /* Browser “Headers and footers” (URL, date) cannot be turned off by script — user must disable in the print dialog. */
    @page {
      margin: 12mm;
    }
    @media print {
      .export-toolbar { display: none !important; }
      body { padding: 0; max-width: none; background: #fff; }
      .export-case-card { page-break-inside: avoid; background: #fff; border-color: #ccc; }
      .export-suite-heading { border-bottom-color: #94a3b8; }
    }
`;

/**
 * Full HTML document for print preview (toolbar + main slot).
 * @param {{ pageTitle: string; docHeadingHtml: string; mainInnerHtml: string; styles?: string }} opts
 * @returns {string}
 */
export function buildExportPrintDocument({ pageTitle, docHeadingHtml, mainInnerHtml, styles = EXPORT_PRINT_BASE_STYLES }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <style>${styles}
  </style>
</head>
<body>
  <div class="export-toolbar" aria-label="Export actions">
    <div class="export-toolbar-row">
      <button type="button" onclick="window.print()">Print / Save as PDF</button>
      <p class="export-toolbar-hint"><strong>PDF tip:</strong> In the print dialog, turn <strong>off</strong> &quot;Headers and footers&quot; (often under More settings) so the PDF has no URL or page title in the margin. Then choose Save as PDF.</p>
    </div>
  </div>
  ${docHeadingHtml}
  ${mainInnerHtml}
</body>
</html>`;
}

/**
 * Open printable HTML in a new tab, or fullscreen overlay if popups are blocked.
 * Uses about:blank + document.write (and iframe srcdoc fallback) so the address bar does not show a blob: URL.
 * @param {string} html - Full HTML document string.
 */
export function openExportHtmlPreview(html) {
  const win = window.open("about:blank", "_blank");
  if (!win || win.closed) {
    showExportPreviewOverlay(html);
    return;
  }

  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch {
    try {
      win.close();
    } catch {
      // ignore
    }
    showExportPreviewOverlay(html);
    return;
  }

  try {
    win.focus();
  } catch {
    // ignore
  }
}

/**
 * Full-screen overlay with iframe when window.open is blocked or document.write fails.
 * @param {string} html - Full HTML document string for iframe.srcdoc.
 */
function showExportPreviewOverlay(html) {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Export preview");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.5);display:flex;flex-direction:column;padding:12px;box-sizing:border-box;";

  const topBar = document.createElement("div");
  topBar.style.cssText =
    "flex:0 0 auto;display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close preview";
  closeBtn.style.cssText =
    "font:inherit;font-weight:600;padding:8px 14px;cursor:pointer;border-radius:6px;border:1px solid #e4e4e7;background:#fff;color:#18181b;";
  topBar.appendChild(closeBtn);

  const iframe = document.createElement("iframe");
  iframe.title = "Export preview";
  iframe.style.cssText =
    "flex:1 1 auto;width:100%;min-height:320px;border:0;border-radius:8px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.15);";
  iframe.srcdoc = html;

  const teardown = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  };

  closeBtn.addEventListener("click", teardown);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) teardown();
  });

  overlay.appendChild(topBar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  closeBtn.focus();
}
