import { parseReleaseId } from "../constants/releasePaths";

export const RELEASE_PROJ_PREFIX = "__release_proj__";
export const RELEASE_REL_SEGMENT = "__rel__";

/**
 * Normalize a release id / ticket.release value to a non-empty string or null.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeReleaseId(value) {
  return (value || "").trim() || null;
}

/**
 * Badge count for a release row: prefer the loaded ticket query total (includes
 * search filters), otherwise the unfiltered list-API ticket_count.
 *
 * @param {number | null | undefined} apiTicketCount
 * @param {{ total?: number, items?: unknown[] } | null | undefined} ticketWindow
 * @returns {number}
 */
export function resolveReleaseTicketBadgeCount(apiTicketCount, ticketWindow) {
  if (ticketWindow == null) return apiTicketCount ?? 0;
  if (typeof ticketWindow.total === "number") return ticketWindow.total;
  return Array.isArray(ticketWindow.items) ? ticketWindow.items.length : 0;
}

/**
 * Decide how to update the Releases lazy ticket cache after a ticket save.
 * Clear, move, and assign all invalidate; same-release field edits patch in place.
 *
 * @param {string | null | undefined} oldId
 * @param {string | null | undefined} newId
 * @returns {{ invalidate: string[], ensure: string[], patch: boolean }}
 */
export function releaseCacheAction(oldId, newId) {
  const oldReleaseId = normalizeReleaseId(oldId);
  const newReleaseId = normalizeReleaseId(newId);
  if (oldReleaseId !== newReleaseId) {
    const invalidate = [];
    const ensure = [];
    if (oldReleaseId) invalidate.push(oldReleaseId);
    if (newReleaseId) {
      invalidate.push(newReleaseId);
      ensure.push(newReleaseId);
    }
    return { invalidate, ensure, patch: false };
  }
  return { invalidate: [], ensure: [], patch: Boolean(oldReleaseId) };
}

/** Synthetic tree path for a ticket-project root in the Releases navigator. */
export function releaseTreePathForProject(projectName) {
  if (!projectName) return null;
  return `${RELEASE_PROJ_PREFIX}/${encodeURIComponent(projectName)}`;
}

/** Synthetic path for a release under a project. */
export function releaseTreePathForRelease(releaseId) {
  const parsed = parseReleaseId(releaseId);
  if (!parsed) return null;
  return `${releaseTreePathForProject(parsed.project)}/${RELEASE_REL_SEGMENT}/${encodeURIComponent(parsed.stem)}`;
}

/** @deprecated Use releaseTreePathForRelease */
export function releaseTreePathForReleaseId(releaseId) {
  return releaseTreePathForRelease(releaseId);
}

/**
 * @param {string | null | undefined} path
 * @returns {{
 *   projectName: string,
 *   releaseId: string | null,
 *   stem: string | null,
 *   isProjectRoot: boolean,
 *   isRelease: boolean,
 * } | null}
 */
export function parseReleaseTreePath(path) {
  const normalized = (path || "").trim().replace(/\\/g, "/");
  if (!normalized.startsWith(`${RELEASE_PROJ_PREFIX}/`)) return null;
  const rest = normalized.slice(`${RELEASE_PROJ_PREFIX}/`.length);
  const relIdx = rest.indexOf(`/${RELEASE_REL_SEGMENT}/`);
  if (relIdx === -1) {
    let projectName = rest;
    try {
      projectName = decodeURIComponent(rest);
    } catch {
      /* keep */
    }
    if (!projectName) return null;
    return {
      projectName,
      releaseId: null,
      stem: null,
      isProjectRoot: true,
      isRelease: false,
    };
  }
  const projectSeg = rest.slice(0, relIdx);
  const stemSeg = rest.slice(relIdx + `/${RELEASE_REL_SEGMENT}/`.length);
  let projectName = projectSeg;
  let stem = stemSeg;
  try {
    projectName = decodeURIComponent(projectSeg);
  } catch {
    /* keep */
  }
  try {
    stem = decodeURIComponent(stemSeg);
  } catch {
    /* keep */
  }
  if (!projectName || !stem) return null;
  return {
    projectName,
    stem,
    releaseId: `${projectName}/${stem}`,
    isProjectRoot: false,
    isRelease: true,
  };
}

export function isReleaseRootPath(path) {
  return parseReleaseTreePath(path)?.isRelease === true;
}

export function isProjectRootPath(path) {
  return parseReleaseTreePath(path)?.isProjectRoot === true;
}

/**
 * Build navigator tree: ticket projects → releases.
 * @param {Array<{ name?: string, directory_path?: string, display_name?: string }>} projects
 * @param {Record<string, Array<object>>} releasesByProject
 * @returns {Array<object>}
 */
export function buildReleaseTree(projects, releasesByProject = {}) {
  return (projects ?? []).map((project) => {
    const projectName =
      project.project_name ||
      project.name ||
      project.display_name ||
      "";
    const childrenLoaded = Object.prototype.hasOwnProperty.call(
      releasesByProject,
      projectName,
    );
    const releases = childrenLoaded ? (releasesByProject[projectName] ?? []) : [];
    const children = releases.map((release) => {
      const releaseId = release.release_id;
      return {
        is_release: true,
        is_project: false,
        release_id: releaseId,
        project_name: projectName,
        file_path: release.file_path,
        name: release.name || releaseId,
        display_name: release.name || releaseId,
        directory_path: releaseTreePathForRelease(releaseId),
        ticket_count: release.ticket_count ?? 0,
        status: release.status,
        project: projectName,
        updated_at: release.updated_at,
        tickets: release.tickets,
      };
    });
    return {
      is_release: false,
      is_project: true,
      project_name: projectName,
      name: projectName,
      display_name: project.display_name || projectName,
      directory_path: releaseTreePathForProject(projectName),
      // No project-level badge on Releases (counts belong on release rows only).
      ticket_count: 0,
      children,
      children_loaded: childrenLoaded,
    };
  });
}

/**
 * Find a node in the release tree by directory_path.
 * @param {Array<object>} tree
 * @param {string | null | undefined} directoryPath
 * @returns {object | null}
 */
export function findReleaseTreeNode(tree, directoryPath) {
  if (!directoryPath) return null;
  for (const node of tree ?? []) {
    if (node.directory_path === directoryPath) return node;
    const child = findReleaseTreeNode(node.children, directoryPath);
    if (child) return child;
  }
  return null;
}

/**
 * Collect directory_path values for release nodes (for pinning).
 * @param {Array<object>} tree
 * @returns {Set<string>}
 */
export function collectReleaseRootPaths(tree) {
  const paths = new Set();
  for (const project of tree ?? []) {
    for (const release of project.children ?? []) {
      if (release?.is_release === true && release.directory_path) {
        paths.add(release.directory_path);
      }
    }
  }
  return paths;
}

/**
 * Collect directory_path values for project nodes (for pinning).
 * @param {Array<object>} tree
 * @returns {Set<string>}
 */
export function collectReleaseProjectPaths(tree) {
  const paths = new Set();
  for (const project of tree ?? []) {
    if (project?.is_project === true && project.directory_path) {
      paths.add(project.directory_path);
    }
  }
  return paths;
}

/**
 * Drop pinned release/project paths that no longer exist.
 * @param {string[]} pinnedPaths
 * @param {Array<object>} releases flat list from list_releases
 * @param {Array<{ name?: string }> | null | undefined} [projects] ticket projects for project pins
 * @returns {string[]}
 */
export function prunePinnedReleasePaths(pinnedPaths, releases, projects = null) {
  if (!pinnedPaths?.length) return [];
  const valid = new Set(
    (releases ?? [])
      .map((r) => releaseTreePathForRelease(r?.release_id))
      .filter(Boolean),
  );
  for (const project of projects ?? []) {
    const path = releaseTreePathForProject(project?.name);
    if (path) valid.add(path);
  }
  // Derive project roots from remaining releases when no projects list is provided.
  if (!projects?.length) {
    for (const release of releases ?? []) {
      const parsed = parseReleaseId(release?.release_id);
      if (parsed?.project) {
        const path = releaseTreePathForProject(parsed.project);
        if (path) valid.add(path);
      }
    }
  }
  return pinnedPaths.filter((p) => valid.has(p));
}

/**
 * Reorder pinned projects first; within a project, pinned releases first.
 * A project is treated as pinned when its path is pinned or it contains a pinned release.
 *
 * @param {Array<object>} tree
 * @param {Set<string>} pinnedPaths
 * @returns {Array<object>}
 */
export function sortReleaseTreeWithPins(tree, pinnedPaths) {
  if (!tree?.length || !pinnedPaths?.size) return tree ?? [];

  const sortReleases = (children) => {
    if (!children?.length) return children ?? [];
    const pinned = [];
    const unpinned = [];
    for (const node of children) {
      if (node?.directory_path && pinnedPaths.has(node.directory_path)) {
        pinned.push(node);
      } else {
        unpinned.push(node);
      }
    }
    if (!pinned.length) return children;
    pinned.sort((a, b) =>
      (a?.display_name ?? a?.name ?? "").localeCompare(b?.display_name ?? b?.name ?? "", undefined, {
        sensitivity: "base",
      }),
    );
    return [...pinned, ...unpinned];
  };

  const withSortedChildren = tree.map((project) => ({
    ...project,
    children: sortReleases(project.children),
  }));

  const pinnedProjects = [];
  const unpinnedProjects = [];
  for (const project of withSortedChildren) {
    const projectPinned =
      Boolean(project?.directory_path && pinnedPaths.has(project.directory_path));
    const hasPinnedRelease = (project.children ?? []).some(
      (r) => r?.directory_path && pinnedPaths.has(r.directory_path),
    );
    if (projectPinned || hasPinnedRelease) pinnedProjects.push(project);
    else unpinnedProjects.push(project);
  }
  if (!pinnedProjects.length) return withSortedChildren;

  pinnedProjects.sort((a, b) =>
    (a?.display_name ?? a?.name ?? "").localeCompare(b?.display_name ?? b?.name ?? "", undefined, {
      sensitivity: "base",
    }),
  );
  return [...pinnedProjects, ...unpinnedProjects];
}

/**
 * Collect expand keys needed to reveal a ticket under its project/release.
 * @param {Array<object>} tree
 * @param {string | null} ticketFilePath
 * @param {string | null | undefined} ticketReleaseId
 * @returns {Set<string>}
 */
export function collectExpandKeysForTicket(tree, ticketFilePath, ticketReleaseId = null) {
  const out = new Set();
  if (!ticketFilePath && !ticketReleaseId) return out;

  if (ticketReleaseId) {
    const releasePath = releaseTreePathForRelease(ticketReleaseId);
    const parsed = parseReleaseId(ticketReleaseId);
    if (parsed && releasePath) {
      out.add(releaseTreePathForProject(parsed.project));
      out.add(releasePath);
      return out;
    }
  }

  for (const project of tree ?? []) {
    for (const release of project.children ?? []) {
      const tickets = release.tickets ?? [];
      if (tickets.some((t) => t.file_path === ticketFilePath)) {
        out.add(project.directory_path);
        out.add(release.directory_path);
        return out;
      }
    }
  }
  return out;
}
