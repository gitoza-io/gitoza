/**
 * Pure helpers for optimistic case moves in the lazy case catalog.
 */

/**
 * @param {string} oldPath
 * @param {string} targetFolderPath
 * @returns {string}
 */
export function computeCaseMovePath(oldPath, targetFolderPath) {
  const target = (targetFolderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const base = (oldPath || "").slice((oldPath || "").lastIndexOf("/") + 1);
  return `${target}/${base}`;
}

/**
 * @param {string} filePath
 * @param {string} newCaseId
 * @returns {string}
 */
export function computeRenamedCasePath(filePath, newCaseId) {
  const norm = (filePath || "").replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  const parent = slash >= 0 ? norm.slice(0, slash) : "";
  const filename = slash >= 0 ? norm.slice(slash + 1) : norm;
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot) : ".yaml";
  const newFile = `${newCaseId}${ext}`;
  return parent ? `${parent}/${newFile}` : newFile;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function parentFolderOfCasePath(filePath) {
  const fp = (filePath || "").replace(/\\/g, "/");
  const li = fp.lastIndexOf("/");
  return li >= 0 ? fp.slice(0, li) : "";
}

/**
 * @param {string[]} filePaths
 * @param {string} targetFolderPath
 * @returns {Array<{ oldPath: string, newPath: string }>}
 */
export function buildCaseMoves(filePaths, targetFolderPath) {
  const target = (targetFolderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const moves = [];
  for (const fp of filePaths || []) {
    if (typeof fp !== "string" || !fp.trim()) continue;
    const oldPath = fp.replace(/\\/g, "/");
    const parent = parentFolderOfCasePath(oldPath);
    if (parent === target) continue;
    moves.push({ oldPath, newPath: computeCaseMovePath(oldPath, target) });
  }
  return moves;
}

/**
 * Build optimistic list rows for case moves by remapping source row metadata to new paths.
 *
 * @param {Array<{ oldPath: string, newPath: string }>} moves
 * @param {object[]} sourceRows
 * @returns {object[]}
 */
export function buildMovedCaseRows(moves, sourceRows) {
  const byPath = new Map(
    (sourceRows ?? []).filter((r) => r?.file_path).map((r) => [r.file_path, { ...r }]),
  );
  return (moves ?? [])
    .filter((m) => m?.oldPath && m?.newPath)
    .map((m) => ({
      ...(byPath.get(m.oldPath) ?? { file_path: m.oldPath }),
      file_path: m.newPath,
    }));
}

/**
 * @param {Map<string, object[]>} casesByPrefix
 * @param {object[] | null | undefined} searchResults
 * @param {string} oldPath
 * @returns {object | null}
 */
export function findCaseRowInCatalog(casesByPrefix, searchResults, oldPath) {
  for (const rows of casesByPrefix.values()) {
    const row = rows.find((r) => r.file_path === oldPath);
    if (row) return { ...row };
  }
  const fromSearch = (searchResults || []).find((r) => r.file_path === oldPath);
  return fromSearch ? { ...fromSearch } : null;
}

/**
 * Merge row snapshots from UI payload, list window, and catalog for optimistic rollback.
 *
 * @param {string[]} filePaths
 * @param {{ rows?: object[], row?: object }} [payload]
 * @param {object[]} [listWindowRows]
 * @param {object[]} [catalogRows]
 * @returns {object[]}
 */
export function resolveCaseRowsForSnapshot(
  filePaths,
  { rows, row } = {},
  listWindowRows = [],
  catalogRows = [],
) {
  const paths = (filePaths || []).filter(Boolean);
  const payloadRows = [];
  if (row?.file_path) payloadRows.push(row);
  if (Array.isArray(rows)) payloadRows.push(...rows);

  const byPath = new Map();
  for (const source of [payloadRows, listWindowRows, catalogRows]) {
    for (const entry of source || []) {
      if (entry?.file_path && !byPath.has(entry.file_path)) {
        byPath.set(entry.file_path, { ...entry });
      }
    }
  }

  return paths.map((filePath) => byPath.get(filePath) ?? { file_path: filePath });
}

/**
 * Build archive/restore/delete handler payload with row data for optimistic rollback.
 *
 * @param {string[]} actionPaths
 * @param {object} clickedCase
 * @param {Map<string, object> | object[]} [knownRows]
 * @returns {{ file_path: string, row: object } | { file_paths: string[], rows: object[] } | null}
 */
export function buildCaseActionPayload(actionPaths, clickedCase, knownRows = []) {
  const paths = (actionPaths || []).filter(Boolean);
  if (!paths.length) return null;

  const byPath = new Map();
  if (knownRows instanceof Map) {
    for (const [key, value] of knownRows) byPath.set(key, value);
  } else if (Array.isArray(knownRows)) {
    for (const entry of knownRows) {
      if (entry?.file_path) byPath.set(entry.file_path, entry);
    }
  }

  const rows = paths.map((filePath) => {
    if (clickedCase?.file_path === filePath) return { ...clickedCase };
    const known = byPath.get(filePath);
    return known ? { ...known } : { file_path: filePath };
  });

  if (paths.length === 1) {
    return { file_path: paths[0], row: rows[0] };
  }
  return { file_paths: paths, rows };
}

/**
 * Apply case moves to in-memory catalog maps (for unit tests).
 *
 * @param {Map<string, object[]>} casesByPrefix
 * @param {object[]} searchResults
 * @param {Array<{ oldPath: string, newPath: string }>} moves
 * @param {(oldPath: string) => object | null} [findRow]
 * @returns {{ casesByPrefix: Map<string, object[]>, searchResults: object[], applied: object[] }}
 */
export function applyCaseMovesToCatalogMaps(
  casesByPrefix,
  searchResults,
  moves,
  findRow = (oldPath) => findCaseRowInCatalog(casesByPrefix, searchResults, oldPath),
) {
  const nextPrefix = new Map(casesByPrefix);
  let nextSearch = [...(searchResults || [])];
  const applied = [];
  const oldPaths = new Set();

  for (const { oldPath, newPath } of moves || []) {
    if (!oldPath || !newPath || oldPath === newPath) continue;
    const row = findRow(oldPath);
    const movedRow = row ? { ...row, file_path: newPath } : { file_path: newPath };
    applied.push({ oldPath, newPath, row });
    oldPaths.add(oldPath);

    for (const [prefix, rows] of nextPrefix.entries()) {
      nextPrefix.set(
        prefix,
        rows.filter((r) => r.file_path !== oldPath),
      );
    }
    nextSearch = nextSearch.filter((r) => r.file_path !== oldPath);

    const parentDir = parentFolderOfCasePath(newPath);
    if (parentDir) {
      const existing = nextPrefix.get(parentDir) ?? [];
      const idx = existing.findIndex((r) => r.file_path === newPath);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...updated[idx], ...movedRow };
        nextPrefix.set(parentDir, updated);
      } else {
        nextPrefix.set(parentDir, [...existing, movedRow]);
      }
    }
    const searchIdx = nextSearch.findIndex((r) => r.file_path === newPath);
    if (searchIdx >= 0) {
      nextSearch[searchIdx] = { ...nextSearch[searchIdx], ...movedRow };
    } else if (row) {
      nextSearch.push(movedRow);
    }
  }

  return { casesByPrefix: nextPrefix, searchResults: nextSearch, applied };
}
