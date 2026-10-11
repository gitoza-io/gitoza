export const RUNS_PREFIX = ".gitoza/test/runs/";

const SHARD_SUFFIXES = [
  { suffix: "/head.yaml", label: "head", order: 0 },
  { suffix: "/head.yml", label: "head", order: 0 },
  { suffix: "/cases.yaml", label: "cases", order: 1 },
  { suffix: "/cases.yml", label: "cases", order: 1 },
  { suffix: "/results.yaml", label: "results", order: 2 },
  { suffix: "/results.yml", label: "results", order: 2 },
];

function normalizePath(filePath) {
  return (filePath || "").replace(/\\/g, "/");
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
export function parseRunDirFromShardPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized.startsWith(RUNS_PREFIX)) return null;
  for (const { suffix } of SHARD_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * @param {string} runDir
 * @returns {boolean}
 */
export function isArchivedRunDir(runDir) {
  const normalized = normalizePath(runDir);
  return normalized.includes(`${RUNS_PREFIX}.archive/`);
}

/**
 * @param {string} runDir
 * @returns {string}
 */
export function runIdFromRunDir(runDir) {
  const normalized = normalizePath(runDir);
  if (!normalized.startsWith(RUNS_PREFIX)) return normalized.split("/").pop() || runDir;
  const rest = normalized.slice(RUNS_PREFIX.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === ".archive" && parts.length >= 2) return parts[1];
  return parts[0] || runDir;
}

/**
 * @param {string} filePath
 * @returns {"head" | "cases" | "results" | null}
 */
export function shardLabelFromPath(filePath) {
  const normalized = normalizePath(filePath);
  for (const { suffix, label } of SHARD_SUFFIXES) {
    if (normalized.endsWith(suffix)) return label;
  }
  return null;
}

function shardOrderFromPath(filePath) {
  const normalized = normalizePath(filePath);
  for (const { suffix, order } of SHARD_SUFFIXES) {
    if (normalized.endsWith(suffix)) return order;
  }
  return 99;
}

/**
 * @param {string} runDir
 * @returns {string}
 */
export function runGroupFallbackLabel(runDir) {
  const runId = runIdFromRunDir(runDir);
  return isArchivedRunDir(runDir) ? `${runId} (archived)` : runId;
}

/**
 * @param {string[]} paths
 * @returns {string}
 */
export function formatRunGroupSubtitle(paths) {
  const labels = (paths ?? [])
    .map(shardLabelFromPath)
    .filter(Boolean);
  const unique = [...new Set(labels)];
  unique.sort((a, b) => {
    const order = { head: 0, cases: 1, results: 2 };
    return (order[a] ?? 99) - (order[b] ?? 99);
  });
  return unique.join(" · ");
}

/**
 * @param {string[]} changedPaths
 * @returns {Array<{ runDir: string, runId: string, archived: boolean, paths: string[] }>}
 */
export function groupRunChangedFiles(changedPaths) {
  const byDir = new Map();

  for (const rawPath of changedPaths ?? []) {
    const path = normalizePath(rawPath);
    const runDir = parseRunDirFromShardPath(path);
    if (!runDir) continue;

    const existing = byDir.get(runDir);
    if (existing) {
      existing.paths.push(path);
    } else {
      byDir.set(runDir, {
        runDir,
        runId: runIdFromRunDir(runDir),
        archived: isArchivedRunDir(runDir),
        paths: [path],
      });
    }
  }

  const groups = Array.from(byDir.values());
  for (const group of groups) {
    group.paths.sort((a, b) => shardOrderFromPath(a) - shardOrderFromPath(b));
  }
  groups.sort((a, b) => a.runDir.localeCompare(b.runDir));
  return groups;
}

const TITLE_KEYS = ["name", "title", "run_name"];

/**
 * Best-effort parse of run display name from head.yaml pending diff text.
 * @param {string} diffText
 * @returns {string | null}
 */
function parseTitleValueFromYamlLine(content) {
  for (const key of TITLE_KEYS) {
    const match = content.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "i"));
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

export function parseRunTitleFromHeadDiff(diffText) {
  if (!diffText?.trim()) return null;

  let fallback = null;
  for (const line of diffText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("+++") || trimmed.startsWith("---") || trimmed.startsWith("@@")) {
      continue;
    }
    const isAdd = trimmed.startsWith("+");
    const isDel = trimmed.startsWith("-");
    const content = isAdd || isDel ? trimmed.slice(1).trim() : trimmed;
    const value = parseTitleValueFromYamlLine(content);
    if (!value) continue;
    if (isAdd) return value;
    if (!fallback) fallback = value;
  }
  return fallback;
}

/**
 * @param {Array<{ path: string, diff: string }>} pathDiffPairs
 * @returns {string}
 */
export function buildMergedRunDiff(pathDiffPairs) {
  const sections = (pathDiffPairs ?? []).map(({ path, diff }) => {
    const header = `# --- ${normalizePath(path)} ---`;
    const body = diff?.trim() ? diff.trimEnd() : "(no diff)";
    return `${header}\n${body}`;
  });
  return sections.join("\n\n");
}
