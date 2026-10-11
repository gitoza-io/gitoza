/**
 * Project → nested suites → cases hierarchy for PDF export and run summary views.
 * Built from flat case rows using `file_path` (same rules as the repository tree).
 */

function projectFromFilePath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  if (!p.startsWith(".gitoza/test/cases/")) return "";
  const parts = p.split("/");
  if (parts.length >= 4) return parts.slice(0, 4).join("/");
  return "";
}

function folderFromFilePath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(0, lastSlash) : "";
}

function projectDisplayName(projectPath) {
  const name = projectPath.split("/").pop() || "";
  return name.replace(/_/g, " ").replace(/-/g, " ").trim() || name;
}

function suiteDisplayName(suitePath) {
  const name = suitePath.split("/").pop() || "";
  return name.replace(/_/g, " ").trim() || name;
}

/**
 * Compare two cases alphabetically by case_id (user-facing ID), with title fallback.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareCasesByCaseId(a, b) {
  const idA = (a?.case_id || a?.title || "").toString();
  const idB = (b?.case_id || b?.title || "").toString();
  return idA.localeCompare(idB, undefined, { sensitivity: "base" });
}

/**
 * Compare two cases by repository tree path (filesystem order, numeric-aware).
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareCasesByTreePath(a, b) {
  const pathA = String(a?.file_path || "").replace(/\\/g, "/");
  const pathB = String(b?.file_path || "").replace(/\\/g, "/");
  const segsA = pathA.split("/").filter(Boolean);
  const segsB = pathB.split("/").filter(Boolean);
  const len = Math.min(segsA.length, segsB.length);

  for (let i = 0; i < len; i += 1) {
    const cmp = segsA[i].localeCompare(segsB[i], undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (cmp !== 0) return cmp;
  }

  if (segsA.length !== segsB.length) return segsA.length - segsB.length;
  return compareCasesByCaseId(a, b);
}

function compareNodesByPath(a, b) {
  return String(a.path || a.key || "").localeCompare(String(b.path || b.key || ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function normalizeRunResult(result) {
  const value = String(result || "").trim().toLowerCase();
  if (value === "pass" || value === "passed") return "passed";
  if (value === "fail" || value === "failed") return "failed";
  if (value === "skip" || value === "skipped") return "skipped";
  return "pending";
}

function resultLabel(result) {
  switch (normalizeRunResult(result)) {
    case "passed":
      return "PASSED";
    case "failed":
      return "FAILED";
    case "skipped":
      return "SKIPPED";
    default:
      return "PENDING";
  }
}

function capitalizePriority(priority) {
  const key = String(priority || "").trim().toLowerCase();
  if (key === "high" || key === "medium" || key === "low") {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return priority ? String(priority) : "High";
}

/**
 * Build nested project/suite/case tree from a pre-sorted flat case list.
 * Each leaf stores `case_index` into the sorted array (for PDF anchor lookup).
 *
 * @param {Array<object>} sortedCases
 * @param {{ forRunExport?: boolean }} [options]
 * @returns {Array<object>}
 */
export function buildExportHierarchy(sortedCases = [], options = {}) {
  if (!sortedCases.length) return [];
  const forRunExport = options.forRunExport === true;
  const projects = new Map();

  sortedCases.forEach((c, caseIndex) => {
    const fp = c.file_path || "";
    const projectPath = projectFromFilePath(fp);
    if (!projectPath) return;
    const folder = folderFromFilePath(fp);

    if (!projects.has(projectPath)) {
      projects.set(projectPath, {
        type: "project",
        key: projectPath,
        path: projectPath,
        displayName: projectDisplayName(projectPath),
        cases: [],
        children: new Map(),
      });
    }
    const project = projects.get(projectPath);

    const leaf = {
      case_index: caseIndex,
      case_id: String(c.case_id || "UNSPECIFIED"),
      title: String(c.title || "Untitled Test Case"),
      priority: capitalizePriority(c.priority),
    };
    if (forRunExport) {
      leaf.result = normalizeRunResult(c.result);
      leaf.result_label = resultLabel(c.result);
    }

    if (folder === projectPath || !folder.startsWith(`${projectPath}/`)) {
      project.cases.push(leaf);
      return;
    }

    const relativeSuitePath = folder.slice(projectPath.length + 1);
    const segments = relativeSuitePath.split("/").filter(Boolean);
    let current = project;
    let currentPath = projectPath;
    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`;
      if (!current.children.has(segment)) {
        current.children.set(segment, {
          type: "suite",
          key: currentPath,
          path: currentPath,
          displayName: suiteDisplayName(currentPath),
          cases: [],
          children: new Map(),
        });
      }
      current = current.children.get(segment);
    }
    current.cases.push(leaf);
  });

  function materialize(node) {
    const children = Array.from(node.children.values()).sort(compareNodesByPath).map(materialize);
    const cases = [...node.cases].sort(
      (a, b) => compareCasesByTreePath(sortedCases[a.case_index], sortedCases[b.case_index]),
    );
    return {
      type: node.type,
      display_name: node.displayName,
      displayName: node.displayName,
      key: node.key,
      path: node.path,
      cases,
      children,
    };
  }

  return Array.from(projects.values()).sort(compareNodesByPath).map(materialize);
}

/**
 * Serialize hierarchy nodes for Typst PDF input (snake_case fields only).
 * @param {Array<object>} hierarchy
 * @returns {Array<object>}
 */
export function toExportTocPayload(hierarchy = []) {
  return hierarchy.map((node) => ({
    type: node.type,
    display_name: node.display_name || node.displayName || "",
    children: toExportTocPayload(node.children || []),
    cases: (node.cases || []).map((leaf) => {
      const entry = {
        case_index: leaf.case_index,
        case_id: leaf.case_id,
        title: leaf.title,
        priority: leaf.priority,
      };
      if (leaf.result_label != null) {
        entry.result = leaf.result;
        entry.result_label = leaf.result_label;
      }
      return entry;
    }),
  }));
}
