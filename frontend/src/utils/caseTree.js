/**
 * Build a Project → Suite → Case tree from repository tree (folders) + case rows.
 * Used for Obsidian-style sidebar: level 1 = projects, level 2 = suites, level 3 = cases (by title, no file names).
 */

import { CASES_ARCHIVE_ROOT } from "../constants/casePaths";

/**
 * Attach cases to each folder node. Cases are placed on the node that directly contains them.
 * Project: directory_path e.g. ".gitoza/test/cases/auth", cases live in .gitoza/test/cases/auth/*.yaml (or in suites under auth/).
 * Suite: directory_path e.g. ".gitoza/test/cases/auth/debug", cases live in .gitoza/test/cases/auth/debug/*.yaml.
 */
function attachCasesToNode(node, rows) {
  const dirPath = node.directory_path || "";
  const prefix = dirPath ? dirPath + "/" : "";
  const casesHere = rows.filter((row) => {
    const fp = row.file_path || "";
    if (!fp.startsWith(prefix)) return false;
    const after = fp.slice(prefix.length);
    return after.indexOf("/") === -1 && (after.endsWith(".yaml") || after.endsWith(".yml"));
  });

  const children = (node.children || []).map((child) => attachCasesToNode(child, rows));
  return {
    ...node,
    children,
    cases: casesHere.map((r) => ({
      file_path: r.file_path,
      case_id: r.case_id,
      title: r.title || r.case_id || "Untitled",
      status: r.status || null,
      priority: r.priority || null,
      tags: r.tags || [],
      type: r.type ?? r.ticket_type ?? null,
      ticket_type: r.ticket_type ?? r.type ?? null,
    })),
  };
}

/**
 * Build full tree with cases attached for sidebar display.
 * @param {array} tree - Repository tree from API (folder nodes only)
 * @param {array} rows - Case rows from index (filteredRows or testCases)
 * @returns {array} Tree with each node having .cases array
 */
export function buildCaseTree(tree, rows) {
  if (!tree?.length) return [];
  return tree.map((node) => attachCasesToNode(node, rows || []));
}

/**
 * True when any folder node (nested) has this directory_path.
 * Used to decide whether an inline create row belongs under a folder or at tree root.
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {boolean}
 */
export function treeContainsDirectoryPath(tree, directoryPath) {
  if (!directoryPath) return false;
  for (const node of tree ?? []) {
    if (node.directory_path === directoryPath) return true;
    if (treeContainsDirectoryPath(node.children, directoryPath)) return true;
  }
  return false;
}

/**
 * Recursively remove tree nodes that have zero cases and no non-empty descendants.
 * Used in search-results mode so empty projects/suites don't clutter the view.
 * @param {array} treeWithCases - Result of buildCaseTree(tree, rows)
 * @returns {array} Pruned tree (new arrays; original is not mutated)
 */
/**
 * Flatten case `file_path` values in the same order CaseTree renders them (each node: children first, then cases).
 * Used for Shift+click range selection in the test repository tree.
 *
 * @param {array} tree - Repository tree from API
 * @param {array} rows - Case rows
 * @param {{ hideEmptyNodes?: boolean }} [options]
 * @returns {string[]}
 */
export function flattenCasePathsInDisplayOrder(tree, rows, options = {}) {
  if (!tree?.length) return [];
  const raw = buildCaseTree(tree, rows || []);
  const tw = options.hideEmptyNodes === true ? pruneEmptyNodes(raw) : raw;
  const out = [];
  function visit(node) {
    for (const child of node.children ?? []) {
      visit(child);
    }
    for (const c of node.cases ?? []) {
      if (c.file_path) out.push(c.file_path);
    }
  }
  for (const root of tw) visit(root);
  return out;
}

export function pruneEmptyNodes(treeWithCases) {
  if (!treeWithCases?.length) return [];
  return treeWithCases
    .map((node) => {
      const prunedChildren = pruneEmptyNodes(node.children ?? []);
      return { ...node, children: prunedChildren };
    })
    .filter((node) => (node.cases?.length ?? 0) > 0 || node.children.length > 0);
}

/**
 * Collect all expandable path keys from a tree (same key format as CaseTree uses).
 * Used by parents for "expand all" / "collapse all" toolbar actions.
 * @param {array} treeWithCases - Result of buildCaseTree(tree, rows)
 * @returns {Set<string>} Set of path keys (e.g. "projectName", "projectName/suiteName")
 */
export function collectExpandKeys(treeWithCases) {
  const keys = new Set();
  function collect(nodes, prefix) {
    for (const n of nodes) {
      const pk = prefix ? `${prefix}/${n.name}` : n.name;
      keys.add(pk);
      if (n.children?.length) collect(n.children, pk);
    }
  }
  collect(treeWithCases || [], "");
  return keys;
}

/**
 * Collect expandable path keys from a folder-only repository tree (no cases attached).
 * @param {array} tree - Repository tree from API
 * @returns {Set<string>}
 */
export function collectFolderExpandKeys(tree) {
  const keys = new Set();
  function collect(nodes, prefix) {
    for (const n of nodes) {
      const pk = prefix ? `${prefix}/${n.name}` : n.name;
      keys.add(pk);
      if (n.children?.length) collect(n.children, pk);
    }
  }
  collect(tree || [], "");
  return keys;
}

/**
 * Parent directory of a case YAML path (repo-relative).
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
export function getParentDirectoryPath(filePath) {
  const fp = (filePath || "").replace(/\\/g, "/");
  const idx = fp.lastIndexOf("/");
  return idx === -1 ? null : fp.slice(0, idx);
}

/**
 * Path keys to expand so `directoryPath` is visible in the folder tree.
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {Set<string>}
 */
export function collectExpandKeysForFolderPath(tree, directoryPath) {
  const keys = new Set();
  if (!directoryPath) return keys;

  function walk(nodes, prefix, ancestors) {
    for (const n of nodes) {
      const pk = prefix ? `${prefix}/${n.name}` : n.name;
      const chain = [...ancestors, pk];
      if (n.directory_path === directoryPath) {
        chain.slice(0, -1).forEach((k) => keys.add(k));
        return true;
      }
      if (
        directoryPath.startsWith((n.directory_path || "") + "/") &&
        walk(n.children ?? [], pk, chain)
      ) {
        keys.add(pk);
        return true;
      }
    }
    return false;
  }

  walk(tree || [], "", []);
  return keys;
}

/**
 * Path key for a folder row (same format as flattenVisibleFolderRows / collectExpandKeysForFolderPath).
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {string | null}
 */
export function collectPathKeyForFolderPath(tree, directoryPath) {
  if (!directoryPath) return null;
  let found = null;

  function walk(nodes, prefix) {
    for (const n of nodes ?? []) {
      const pk = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.directory_path === directoryPath) {
        found = pk;
        return true;
      }
      if (
        directoryPath.startsWith((n.directory_path || "") + "/") &&
        walk(n.children ?? [], pk)
      ) {
        return true;
      }
    }
    return false;
  }

  walk(tree || [], "");
  return found;
}

function mapRowToCaseItem(r) {
  return {
    file_path: r.file_path,
    case_id: r.case_id,
    title: r.title || r.case_id || "Untitled",
    status: r.status || null,
    priority: r.priority || null,
    tags: r.tags || [],
  };
}

/**
 * Direct case rows in a folder (not recursive into child suites).
 * Same rules as attachCasesToNode for non-archived browse mode.
 *
 * @param {array} rows
 * @param {string | null | undefined} directoryPath
 * @returns {Array<{ file_path: string, case_id: string, title: string, status: string | null, priority: string | null, tags: string[] }>}
 */
export function getDirectCasesInFolder(rows, directoryPath) {
  if (!directoryPath) return [];
  const prefix = `${directoryPath}/`;
  const casesHere = (rows || []).filter((row) => {
    const fp = row.file_path || "";
    if (!fp.startsWith(prefix)) return false;
    const after = fp.slice(prefix.length);
    return after.indexOf("/") === -1 && (after.endsWith(".yaml") || after.endsWith(".yml"));
  });
  return casesHere.map(mapRowToCaseItem);
}

/**
 * Map raw index rows to case list items for flat virtual lists.
 * @param {array} rows
 * @returns {Array<{ file_path: string, case_id: string, title: string, status: string | null, priority: string | null, tags: string[] }>}
 */
export function mapRowsToCaseListItems(rows) {
  return (rows || []).map(mapRowToCaseItem);
}

function isCaseYamlPath(filePath) {
  const fp = filePath || "";
  return fp.endsWith(".yaml") || fp.endsWith(".yml");
}

function sortCaseListItems(items) {
  return [...(items || [])].sort((a, b) => {
    const idA = (a.case_id || a.file_path || "").toLowerCase();
    const idB = (b.case_id || b.file_path || "").toLowerCase();
    if (idA !== idB) return idA.localeCompare(idB);
    return (a.file_path || "").localeCompare(b.file_path || "");
  });
}

/**
 * Find a folder node by directory_path in the repository tree.
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {object | null}
 */
export function findFolderNode(tree, directoryPath) {
  if (!directoryPath) return null;
  let found = null;
  function walk(nodes) {
    for (const n of nodes ?? []) {
      if (n.directory_path === directoryPath) {
        found = n;
        return;
      }
      walk(n.children);
      if (found) return;
    }
  }
  walk(tree);
  return found;
}

/**
 * Display label for a folder path in the case list column header.
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {string | null}
 */
export function findFolderDisplayName(tree, directoryPath) {
  if (!directoryPath) return null;
  const found = findFolderNode(tree, directoryPath);
  if (!found) return directoryPath.split("/").pop() || directoryPath;
  const name = found.display_name ?? found.name ?? "";
  return found.is_project ? name.replace(/\.gitoza\.test$/i, "") : name;
}

/**
 * All case YAML rows under a folder prefix (recursive into child suites).
 * @param {array} rows
 * @param {string | null | undefined} directoryPath
 */
export function getRecursiveCasesInFolder(rows, directoryPath) {
  if (!directoryPath) return [];
  const prefix = `${directoryPath}/`;
  const casesHere = (rows || []).filter((row) => {
    const fp = row.file_path || "";
    if (fp === `${directoryPath}.yaml` || fp === `${directoryPath}.yml`) return true;
    if (!fp.startsWith(prefix)) return false;
    return isCaseYamlPath(fp);
  });
  return sortCaseListItems(casesHere.map(mapRowToCaseItem));
}

/**
 * Collect directory_path values for a folder and all descendants (for lazy-load).
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {string[]}
 */
export function collectDescendantDirectoryPaths(tree, directoryPath) {
  const node = findFolderNode(tree, directoryPath);
  if (!node) return directoryPath ? [directoryPath] : [];
  const paths = [];
  function walk(n) {
    if (n.directory_path) paths.push(n.directory_path);
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return paths;
}

/**
 * Cases for list column: recursive for all folder levels (projects and suites).
 * @param {array} rows
 * @param {array} tree - Repository tree (kept for API stability; selection is path-based)
 * @param {string | null | undefined} directoryPath
 */
export function getCasesForFolderSelection(rows, tree, directoryPath) {
  if (!directoryPath) return [];
  return getRecursiveCasesInFolder(rows, directoryPath);
}

/**
 * @typedef {{ file_path: string, case_id: string, title: string, status?: string | null, priority?: string | null, tags?: string[] }} CaseListItem
 * @typedef {{ type: 'case', item: CaseListItem }} CaseListCaseEntry
 * @typedef {{ type: 'suiteHeader', directoryPath: string, label: string, depth: number }} CaseListSuiteHeaderEntry
 * @typedef {CaseListCaseEntry | CaseListSuiteHeaderEntry} CaseListRenderEntry
 */

function walkFolderNodeForGroupedList(node, rows, tree, entries, depth) {
  const path = node.directory_path;
  if (path) {
    const direct = sortCaseListItems(getDirectCasesInFolder(rows, path));
    for (const item of direct) {
      entries.push({ type: "case", item });
    }
  }
  for (const child of node.children ?? []) {
    if (child.is_run === true) continue;
    const childPath = child.directory_path;
    if (!childPath) continue;
    if (getRecursiveCasesInFolder(rows, childPath).length === 0) continue;
    entries.push({
      type: "suiteHeader",
      directoryPath: childPath,
      label: findFolderDisplayName(tree, childPath) ?? child.display_name ?? child.name ?? childPath,
      depth,
    });
    walkFolderNodeForGroupedList(child, rows, tree, entries, depth + 1);
  }
}

/**
 * Grouped column-2 entries: direct cases first, then subsuite headers + nested content (depth-first).
 * @param {array} rows
 * @param {array} tree
 * @param {string | null | undefined} directoryPath
 * @returns {CaseListRenderEntry[]}
 */
export function buildGroupedCaseListEntries(rows, tree, directoryPath) {
  if (!directoryPath) return [];
  const node = findFolderNode(tree, directoryPath);
  if (!node) {
    return getRecursiveCasesInFolder(rows, directoryPath).map((item) => ({
      type: "case",
      item,
    }));
  }
  const entries = [];
  walkFolderNodeForGroupedList(node, rows, tree, entries, 0);
  return entries;
}

/**
 * Case items in grouped display order (for multi-select range and drag-drop).
 * @param {CaseListRenderEntry[]} entries
 * @returns {CaseListItem[]}
 */
export function getCasesInGroupedOrder(entries) {
  return (entries ?? []).filter((e) => e.type === "case").map((e) => e.item);
}

/** First-level project path for any folder under cases (active or `.archive/`). */
export function projectPathFromDirectory(directoryPath) {
  const norm = (directoryPath || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm) return "";
  if (isProjectDirectoryPath(norm)) return norm;
  const parts = norm.split("/");
  if (
    parts.length >= 5 &&
    parts[0] === ".gitoza" &&
    parts[1] === "test" &&
    parts[2] === "cases" &&
    parts[3] === ".archive"
  ) {
    return parts.slice(0, 5).join("/");
  }
  if (parts.length >= 4 && parts[0] === ".gitoza" && parts[1] === "test" && parts[2] === "cases") {
    return parts.slice(0, 4).join("/");
  }
  return "";
}

/**
 * True when path is a first-level project directory.
 * @param {string} directoryPath
 * @param {{ archiveMode?: boolean }} [options] - When set, only match active or archive roots.
 */
export function isProjectDirectoryPath(directoryPath, options = {}) {
  const norm = (directoryPath || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm) return false;
  const parts = norm.split("/");
  const archiveMode = options.archiveMode;
  if (archiveMode === true) {
    return (
      parts.length === 5 &&
      parts[0] === ".gitoza" &&
      parts[1] === "test" &&
      parts[2] === "cases" &&
      parts[3] === ".archive"
    );
  }
  if (archiveMode === false) {
    return (
      parts.length === 4 &&
      parts[0] === ".gitoza" &&
      parts[1] === "test" &&
      parts[2] === "cases"
    );
  }
  if (norm.startsWith(`${CASES_ARCHIVE_ROOT}/`) || norm === CASES_ARCHIVE_ROOT) {
    return (
      parts.length === 5 &&
      parts[0] === ".gitoza" &&
      parts[1] === "test" &&
      parts[2] === "cases" &&
      parts[3] === ".archive"
    );
  }
  return (
    parts.length === 4 &&
    parts[0] === ".gitoza" &&
    parts[1] === "test" &&
    parts[2] === "cases"
  );
}

/**
 * Map dashboard project rows to repository folder tree nodes (projects only, no suites).
 * @param {{ projects?: array } | null | undefined} dashboardSummary
 * @returns {array}
 */
export function buildProjectNodesFromDashboard(dashboardSummary) {
  const projects = dashboardSummary?.projects ?? [];
  return projects.map((p) => {
    const path = p.project_path || "";
    const segment = path.split("/").pop() || path;
    const name = segment.includes(".gitoza.test") ? segment : `${segment}.gitoza.test`;
    const display = (p.project_name ?? segment).replace(/_/g, " ");
    return {
      type: "folder",
      name,
      display_name: display,
      directory_path: path,
      path_from_root: [display],
      is_project: true,
      case_count: p.total_test_cases ?? 0,
      children: [],
    };
  });
}

/**
 * Merge dashboard project metadata into an existing tree without dropping loaded suite subtrees.
 * @param {array | null | undefined} existingTree
 * @param {{ projects?: array } | null | undefined} dashboardSummary
 * @returns {array}
 */
function normalizeTreePath(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function indexTreeNodesByPath(nodes) {
  const prevByPath = new Map();
  for (const node of nodes ?? []) {
    const dir = normalizeTreePath(node.directory_path);
    if (dir) prevByPath.set(dir, node);
    const repoDir = normalizeTreePath(node.repo_directory_path);
    if (repoDir) prevByPath.set(repoDir, node);
  }
  return prevByPath;
}

export function mergeProjectNodesFromDashboard(existingTree, dashboardSummary) {
  const fromDashboard = buildProjectNodesFromDashboard(dashboardSummary);
  if (!fromDashboard.length) return existingTree ?? [];

  const prevByPath = indexTreeNodesByPath(existingTree);

  return fromDashboard.map((dashNode) => {
    const existing = prevByPath.get(normalizeTreePath(dashNode.directory_path));
    if (!existing) return dashNode;
    return {
      ...existing,
      name: dashNode.name ?? existing.name,
      display_name: dashNode.display_name ?? existing.display_name,
      case_count: dashNode.case_count ?? existing.case_count,
      path_from_root: dashNode.path_from_root ?? existing.path_from_root,
      is_project: true,
    };
  });
}

/**
 * Merge API project nodes into an existing tree without dropping loaded suite subtrees.
 * @param {array | null | undefined} existingTree
 * @param {array} apiNodes
 * @returns {array}
 */
export function mergeProjectListWithExisting(existingTree, apiNodes) {
  const incoming = Array.isArray(apiNodes) ? apiNodes : [];
  if (!incoming.length) return [];

  const prevByPath = indexTreeNodesByPath(existingTree);
  return incoming.map((apiNode) => {
    const existing = prevByPath.get(normalizeTreePath(apiNode.directory_path));
    if (!existing) return apiNode;
    const children = existing.children?.length ? existing.children : (apiNode.children ?? []);
    return {
      ...existing,
      ...apiNode,
      children: children ?? [],
      is_project: apiNode.is_project ?? existing.is_project,
    };
  });
}

/**
 * Replace or insert a loaded project subtree into the repository folder tree.
 * @param {array | null | undefined} tree
 * @param {string} folderPath
 * @param {object} folderNode
 * @returns {array}
 */
export function mergeFolderSubtreeIntoTree(tree, folderPath, folderNode) {
  if (!folderNode || !folderPath) return tree ?? [];
  const norm = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");

  function mergeAt(nodes) {
    if (!nodes?.length) return nodes ?? [];
    const idx = nodes.findIndex((n) => n.directory_path === norm);
    if (idx >= 0) {
      const next = [...nodes];
      next[idx] = folderNode;
      return next;
    }
    return nodes.map((n) => {
      if (!n.children?.length) return n;
      const childIdx = n.children.findIndex((c) => c.directory_path === norm);
      if (childIdx >= 0) {
        const children = [...n.children];
        children[childIdx] = folderNode;
        return { ...n, children };
      }
      const mergedChildren = mergeAt(n.children);
      if (mergedChildren !== n.children) {
        return { ...n, children: mergedChildren };
      }
      return n;
    });
  }

  const current = tree ?? [];
  const idx = current.findIndex((n) => n.directory_path === norm);
  if (idx >= 0) {
    const next = [...current];
    next[idx] = folderNode;
    return next;
  }
  return [...current, folderNode].sort((a, b) =>
    (a.display_name ?? a.name ?? "").localeCompare(b.display_name ?? b.name ?? ""),
  );
}
