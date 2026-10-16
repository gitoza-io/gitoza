import { filePath2Breadcrumb } from "./breadcrumb";
import { pathsToMinimalCaseRows } from "./confirmChangesCaseTree";
import {
  formatRunGroupSubtitle,
  runGroupFallbackLabel,
} from "./confirmChangesRunGroups";
import { isTicketDocPath, ticketLeafIdFromPath } from "../constants/ticketPaths";
import {
  isWikiGitkeepPath,
  isWikiTrackedPath,
  isWikiDocPath,
  wikiGitkeepFolderLabel,
  wikiPageIdFromPath,
} from "../constants/wikiPaths";

const CASES_PREFIX = ".gitoza/test/cases/";

function normalizePath(path) {
  return (path || "").replace(/\\/g, "/");
}

function isCasePath(path) {
  return normalizePath(path).startsWith(CASES_PREFIX);
}

function isDiscardableGitozaPath(path) {
  const p = normalizePath(path);
  return p === ".gitoza" || p.startsWith(".gitoza/");
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function breadcrumbLabelForCasePath(filePath) {
  const crumbs = filePath2Breadcrumb(filePath);
  return crumbs.length > 0 ? crumbs.join(" › ") : normalizePath(filePath);
}

/**
 * @param {string} sectionId
 * @param {string} title
 * @param {number} count
 * @returns {{ kind: 'sectionHeader', id: string, title: string, count: number }}
 */
function sectionHeader(sectionId, title, count, { canDiscard = true } = {}) {
  return {
    kind: "sectionHeader",
    id: `section:${sectionId}`,
    sectionId,
    title,
    count,
    canDiscard,
  };
}

/**
 * Collect repo-relative paths + optional status metadata for discarding a changelist entry.
 * Run groups always return all shard paths in the group (atomic discard).
 *
 * @param {object} entry
 * @returns {{ paths: string[], changes: Array<{ path: string, status?: string, old_path?: string | null }>, label: string } | null}
 */
export function discardTargetFromChangelistEntry(entry) {
  if (!entry) return null;
  if (entry.kind === "case") {
    const path = normalizePath(entry.file_path);
    if (!path) return null;
    return {
      paths: [path],
      changes: [
        {
          path,
          status: entry.status || "M",
          old_path: entry.old_path ? normalizePath(entry.old_path) : null,
        },
      ],
      label: entry.label || path,
    };
  }
  if (entry.kind === "runGroup") {
    const paths = (entry.paths || []).map(normalizePath).filter(Boolean);
    if (paths.length === 0) return null;
    return {
      paths,
      changes: [],
      label: entry.title || entry.runId || entry.runDir,
    };
  }
  if (
    entry.kind === "ticket" ||
    entry.kind === "wiki" ||
    entry.kind === "template" ||
    entry.kind === "config" ||
    entry.kind === "other"
  ) {
    const path = normalizePath(entry.path);
    if (!path) return null;
    // Discard IPC only allows paths under .gitoza/
    if (entry.kind === "other" && !isDiscardableGitozaPath(path)) {
      return null;
    }
    const changes =
      (entry.kind === "ticket" || entry.kind === "wiki" || entry.kind === "other") &&
      entry.status
        ? [
            {
              path,
              status: entry.status,
              old_path: entry.old_path ? normalizePath(entry.old_path) : null,
            },
          ]
        : [];
    return {
      paths: [path],
      changes,
      label:
        entry.kind === "config"
          ? "Project config"
          : entry.title || entry.label || path,
    };
  }
  return null;
}

/**
 * Collect all discard paths for a section (cases / runs / tickets / wiki / templates / config).
 *
 * @param {Array<object>} entries
 * @param {string} sectionId
 * @returns {{ paths: string[], changes: Array<{ path: string, status?: string, old_path?: string | null }>, label: string, itemCount: number } | null}
 */
export function discardTargetFromSection(entries, sectionId) {
  const list = entries || [];
  const header = list.find((e) => e.kind === "sectionHeader" && e.sectionId === sectionId);
  if (!header) return null;

  const paths = [];
  const changes = [];
  let itemCount = 0;
  let collecting = false;
  for (const entry of list) {
    if (entry.kind === "sectionHeader") {
      collecting = entry.sectionId === sectionId;
      continue;
    }
    if (!collecting) continue;
    const target = discardTargetFromChangelistEntry(entry);
    if (!target) continue;
    itemCount += 1;
    for (const p of target.paths) {
      if (!paths.includes(p)) paths.push(p);
    }
    for (const c of target.changes) {
      changes.push(c);
    }
  }
  if (paths.length === 0) return null;
  return {
    paths,
    changes,
    label: header.title || sectionId,
    itemCount,
  };
}

/**
 * Build flat changelist rows for Confirm (VS Code-style sidebar).
 *
 * @param {{
 *   caseChanges?: Array<{ path?: string, status?: string, old_path?: string | null }>;
 *   runGroups?: Array<{ runDir: string, runId?: string, paths?: string[], archived?: boolean }>;
 *   templateFiles?: string[];
 *   ticketFiles?: string[];
 *   ticketChanges?: Array<{ path?: string, status?: string, old_path?: string | null }>;
 *   ticketMetaByPath?: Record<string, { title?: string, type?: string, ticket_id?: string }>;
 *   wikiFiles?: string[];
 *   wikiChanges?: Array<{ path?: string, status?: string, old_path?: string | null }>;
 *   wikiMetaByPath?: Record<string, { title?: string, page_id?: string }>;
 *   configFiles?: string[];
 *   otherFiles?: string[];
 *   otherChanges?: Array<{ path?: string, status?: string, old_path?: string | null }>;
 *   runLabelsByDir?: Record<string, string>;
 * }} params
 * @returns {Array<object>}
 */
export function buildConfirmChangelistEntries({
  caseChanges = [],
  runGroups = [],
  templateFiles = [],
  ticketFiles = [],
  ticketChanges = [],
  ticketMetaByPath = {},
  wikiFiles = [],
  wikiChanges = [],
  wikiMetaByPath = {},
  configFiles = [],
  otherFiles = [],
  otherChanges = [],
  runLabelsByDir = {},
} = {}) {
  const entries = [];

  const sortedCaseChanges = [...caseChanges]
    .filter((c) => isCasePath(c?.path))
    .sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)));

  if (sortedCaseChanges.length > 0) {
    entries.push(sectionHeader("cases", "Cases", sortedCaseChanges.length));
    const rows = pathsToMinimalCaseRows(sortedCaseChanges.map((c) => c.path));
    const rowByPath = new Map(rows.map((r) => [normalizePath(r.file_path), r]));
    for (const change of sortedCaseChanges) {
      const path = normalizePath(change.path);
      const row = rowByPath.get(path) ?? {
        file_path: path,
        case_id: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
        title: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
      };
      entries.push({
        kind: "case",
        id: `case:${path}`,
        file_path: path,
        caseRow: row,
        status: (change.status || "M").toUpperCase(),
        old_path: change.old_path ? normalizePath(change.old_path) : null,
        label: breadcrumbLabelForCasePath(path),
      });
    }
  }

  if (runGroups.length > 0) {
    entries.push(sectionHeader("runs", "Runs", runGroups.length));
    for (const group of runGroups) {
      const title = runLabelsByDir[group.runDir] ?? runGroupFallbackLabel(group.runDir);
      const subtitle = formatRunGroupSubtitle(group.paths ?? []);
      entries.push({
        kind: "runGroup",
        id: `run:${group.runDir}`,
        runDir: group.runDir,
        runId: group.runId,
        paths: group.paths ?? [],
        title,
        subtitle,
      });
    }
  }

  const statusByTicketPath = new Map();
  for (const change of ticketChanges) {
    if (!change?.path || !isTicketDocPath(change.path)) continue;
    statusByTicketPath.set(normalizePath(change.path), {
      status: (change.status || "M").toUpperCase(),
      old_path: change.old_path ? normalizePath(change.old_path) : null,
    });
  }
  const ticketPathSet = new Set([
    ...ticketFiles.filter(isTicketDocPath).map(normalizePath),
    ...statusByTicketPath.keys(),
  ]);
  const tickets = [...ticketPathSet].sort();
  if (tickets.length > 0) {
    entries.push(sectionHeader("tickets", "Tickets", tickets.length));
    for (const path of tickets) {
      const changeMeta = statusByTicketPath.get(path);
      const leaf = ticketLeafIdFromPath(path);
      const hydrated = ticketMetaByPath[path] ?? {};
      const ticketId = (hydrated.ticket_id || leaf).trim() || leaf;
      const title = (hydrated.title || ticketId).trim() || ticketId;
      const type = (hydrated.type || "task").trim().toLowerCase() || "task";
      entries.push({
        kind: "ticket",
        id: `ticket:${path}`,
        path,
        status: changeMeta?.status ?? null,
        old_path: changeMeta?.old_path ?? null,
        title,
        type,
        ticket_id: ticketId,
        label: title,
      });
    }
  }

  const statusByWikiPath = new Map();
  for (const change of wikiChanges) {
    if (!change?.path || !isWikiTrackedPath(change.path)) continue;
    statusByWikiPath.set(normalizePath(change.path), {
      status: (change.status || "M").toUpperCase(),
      old_path: change.old_path ? normalizePath(change.old_path) : null,
    });
  }
  const wikiPathSet = new Set([
    ...wikiFiles.filter(isWikiTrackedPath).map(normalizePath),
    ...statusByWikiPath.keys(),
  ]);
  const wikis = [...wikiPathSet].sort();
  if (wikis.length > 0) {
    entries.push(sectionHeader("wiki", "Wiki", wikis.length));
    for (const path of wikis) {
      const changeMeta = statusByWikiPath.get(path);
      if (isWikiGitkeepPath(path)) {
        const folderLabel = wikiGitkeepFolderLabel(path);
        entries.push({
          kind: "wiki",
          id: `wiki:${path}`,
          path,
          status: changeMeta?.status ?? null,
          old_path: changeMeta?.old_path ?? null,
          title: folderLabel,
          page_id: folderLabel,
          label: `${folderLabel} (folder)`,
          is_folder: true,
        });
        continue;
      }
      if (!isWikiDocPath(path)) continue;
      const leaf = wikiPageIdFromPath(path);
      const hydrated = wikiMetaByPath[path] ?? {};
      const pageId = (hydrated.page_id || leaf).trim() || leaf;
      const title = (hydrated.title || pageId).trim() || pageId;
      entries.push({
        kind: "wiki",
        id: `wiki:${path}`,
        path,
        status: changeMeta?.status ?? null,
        old_path: changeMeta?.old_path ?? null,
        title,
        page_id: pageId,
        label: title,
      });
    }
  }

  const templates = [...templateFiles].map(normalizePath).sort();
  if (templates.length > 0) {
    entries.push(sectionHeader("templates", "Templates", templates.length));
    for (const path of templates) {
      entries.push({
        kind: "template",
        id: `template:${path}`,
        path,
      });
    }
  }

  const configs = [...configFiles].map(normalizePath).sort();
  if (configs.length > 0) {
    entries.push(sectionHeader("config", "Project config", configs.length));
    for (const path of configs) {
      entries.push({
        kind: "config",
        id: `config:${path}`,
        path,
      });
    }
  }

  const statusByOtherPath = new Map();
  for (const change of otherChanges) {
    if (!change?.path) continue;
    statusByOtherPath.set(normalizePath(change.path), {
      status: (change.status || "M").toUpperCase(),
      old_path: change.old_path ? normalizePath(change.old_path) : null,
    });
  }
  const otherPathSet = new Set([
    ...otherFiles.map(normalizePath).filter(Boolean),
    ...statusByOtherPath.keys(),
  ]);
  const others = [...otherPathSet].sort();
  if (others.length > 0) {
    entries.push(
      sectionHeader("other", "Other", others.length, {
        canDiscard: others.some(isDiscardableGitozaPath),
      }),
    );
    for (const path of others) {
      const changeMeta = statusByOtherPath.get(path);
      entries.push({
        kind: "other",
        id: `other:${path}`,
        path,
        status: changeMeta?.status ?? null,
        old_path: changeMeta?.old_path ?? null,
        label: path,
        discardable: isDiscardableGitozaPath(path),
      });
    }
  }

  return entries;
}

/**
 * @param {Array<object>} entries
 * @returns {{ selectionKind: 'caseFolder' | 'runGroup' | 'other', selectedFilePath: string | null, selectedRunDir: string | null } | null}
 */
export function selectionFromChangelistEntry(entry) {
  if (!entry) return null;
  if (entry.kind === "case") {
    return {
      selectionKind: "caseFolder",
      selectedFilePath: entry.file_path,
      selectedRunDir: null,
    };
  }
  if (entry.kind === "runGroup") {
    return {
      selectionKind: "runGroup",
      selectedFilePath: null,
      selectedRunDir: entry.runDir,
    };
  }
  if (
    entry.kind === "ticket" ||
    entry.kind === "wiki" ||
    entry.kind === "template" ||
    entry.kind === "config" ||
    entry.kind === "other"
  ) {
    return {
      selectionKind: "other",
      selectedFilePath: entry.path,
      selectedRunDir: null,
    };
  }
  return null;
}

/**
 * @param {Array<object>} entries
 * @returns {{ selectionKind: 'caseFolder' | 'runGroup' | 'other', selectedFilePath: string | null, selectedRunDir: string | null } | null}
 */
export function findFirstSelectableEntry(entries) {
  const entry = (entries || []).find(
    (e) =>
      e.kind === "case" ||
      e.kind === "runGroup" ||
      e.kind === "ticket" ||
      e.kind === "wiki" ||
      e.kind === "template" ||
      e.kind === "config" ||
      e.kind === "other",
  );
  return selectionFromChangelistEntry(entry);
}

/**
 * Estimate row height for virtual list.
 * @param {object} entry
 * @returns {number}
 */
export function estimateChangelistRowHeight(entry) {
  if (entry?.kind === "sectionHeader") return 28;
  if (entry?.kind === "runGroup" && entry.subtitle) return 40;
  return 32;
}
