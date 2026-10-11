/** Normalize CRLF and lone CR to LF so marker regexes work on Windows conflict files. */
export function normalizeLineEndings(content) {
  return (content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Surrounding common lines attached for scrollable conflict pane context. */
const CONTEXT_LINES = 20;

/**
 * Mid marker may sit at the start of the slice when HEAD (shared) side is empty:
 * `<<<<<<< HEAD\n=======\n...`
 * @returns {{ index: number, length: number } | null}
 */
function findConflictMidMarker(text) {
  const match = text.match(/(?:^|\n)=======\n/);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

/**
 * End marker may sit at the start of the slice when yours side is empty:
 * `=======\n>>>>>>> branch`
 * Consumes the trailing newline after the marker line when present so an empty
 * chosen side does not leave a blank line in the resolved file.
 * @returns {{ index: number, length: number } | null}
 */
function findConflictEndMarker(text) {
  const match = text.match(/(?:^|\n)>>>>>>> [^\n]*(?:\n|$)/);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

/** Split text into lines, dropping a single trailing empty segment from a final `\n`. */
function linesFromText(text) {
  if (!text) return [];
  const lines = String(text).split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function takeLastLines(text, n) {
  if (n <= 0 || !text) return "";
  return linesFromText(text).slice(-n).join("\n");
}

function takeFirstLines(text, n) {
  if (n <= 0 || !text) return "";
  return linesFromText(text).slice(0, n).join("\n");
}

/**
 * Parse Git conflict markers and return per-block content pairs.
 * During rebase onto upstream (this app's sync flow):
 * Remote / "Shared changes" = content between <<<<<<< and ======= (HEAD).
 * My / "Your changes" = content between ======= and >>>>>>>.
 *
 * Display-only fields (do not feed into resolve rewrite):
 * - beforeContext / afterContext: up to ±20 surrounding common lines
 */
export function parseConflictBlocks(content) {
  const blocks = [];
  const markerStart = /<<<<<<< [^\n]*\n/;
  let rest = normalizeLineEndings(content);

  while (rest.length > 0) {
    const startIdx = rest.search(markerStart);
    if (startIdx === -1) break;
    const prefix = rest.slice(0, startIdx);
    const beforeContext = takeLastLines(prefix, CONTEXT_LINES);

    const startMatch = rest.match(markerStart);
    const startLen = startMatch ? startMatch[0].length : 0;
    const afterStart = rest.slice(startIdx + startLen);
    const mid = findConflictMidMarker(afterStart);
    if (!mid) break;
    const remoteContent = afterStart.slice(0, mid.index);
    const afterMid = afterStart.slice(mid.index + mid.length);
    const end = findConflictEndMarker(afterMid);
    if (!end) break;
    const myContent = afterMid.slice(0, end.index);
    rest = afterMid.slice(end.index + end.length);
    const afterContext = takeFirstLines(rest, CONTEXT_LINES);
    blocks.push({
      remoteContent,
      myContent,
      beforeContext,
      afterContext,
    });
  }

  return blocks;
}

/**
 * Build resolved file content by replacing each conflict block with selected side.
 * choices: array of "remote" | "my".
 */
export function buildResolvedContent(content, choices) {
  const normalized = normalizeLineEndings(content);
  const blocks = parseConflictBlocks(normalized);
  if (blocks.length === 0) return content || "";

  let result = "";
  let rest = normalized;
  const markerStart = /<<<<<<< [^\n]*\n/;

  for (let i = 0; i < blocks.length; i++) {
    const startIdx = rest.search(markerStart);
    if (startIdx === -1) break;
    result += rest.slice(0, startIdx);

    const startMatch = rest.match(markerStart);
    const startLen = startMatch ? startMatch[0].length : 0;
    let afterStart = rest.slice(startIdx + startLen);

    const mid = findConflictMidMarker(afterStart);
    if (!mid) break;
    afterStart = afterStart.slice(mid.index + mid.length);

    const end = findConflictEndMarker(afterStart);
    if (!end) break;

    const restAfterBlock = afterStart.slice(end.index + end.length);
    const chosen = choices[i] === "remote" ? blocks[i].remoteContent : blocks[i].myContent;
    result += chosen;

    if (
      restAfterBlock.length > 0 &&
      chosen.length > 0 &&
      !chosen.endsWith("\n") &&
      !restAfterBlock.startsWith("\n")
    ) {
      result += "\n";
    }
    rest = restAfterBlock;
  }

  result += rest;
  return result;
}

/** @returns {"content"|"modify_delete"|"rename"|"unknown"} */
export function getConflictKind(file) {
  if (file?.conflict_kind) return file.conflict_kind;
  if (parseConflictBlocks(file?.content || "").length > 0) return "content";
  return "unknown";
}

export function contentBlocksForFile(file) {
  return parseConflictBlocks(file?.content || "");
}

const MODIFY_DELETE_ACTIONS = new Set(["keep_mine", "keep_both", "keep_theirs"]);

export function countRenameConflicts(files) {
  return files.filter((f) => getConflictKind(f) === "rename").length;
}

export function countModifyDeleteConflicts(files) {
  return files.filter((f) => getConflictKind(f) === "modify_delete").length;
}

/** @returns {Record<string, object>} */
export function createInitialResolverState(files) {
  const state = {};
  for (const file of files) {
    const path = file.file_path;
    const kind = getConflictKind(file);
    if (kind === "modify_delete") {
      state[path] = { kind: "modify_delete", action: "keep_mine" };
    } else if (kind === "rename") {
      state[path] = {
        kind: "rename",
        chosenPath: file.your_path ?? null,
      };
    } else if (kind === "content") {
      const blocks = contentBlocksForFile(file);
      state[path] = { kind: "content", sectionChoices: blocks.map(() => "my") };
    } else {
      state[path] = { kind: "unknown" };
    }
  }
  return state;
}

export function isFileFullyResolved(file, state) {
  const path = file.file_path;
  const entry = state[path];
  const kind = entry?.kind ?? getConflictKind(file);
  if (kind === "unknown") return false;
  if (kind === "modify_delete") {
    return MODIFY_DELETE_ACTIONS.has(entry?.action);
  }
  if (kind === "rename") {
    return Boolean(entry?.chosenPath);
  }
  if (kind === "content") {
    const blocks = contentBlocksForFile(file);
    const choices = entry?.sectionChoices || [];
    return blocks.length > 0 && blocks.every((_, i) => choices[i] === "my" || choices[i] === "remote");
  }
  return false;
}

export function countResolvedFiles(files, state) {
  return files.filter((f) => isFileFullyResolved(f, state)).length;
}

export function findFirstUnresolvedPath(files, state) {
  const hit = files.find((f) => !isFileFullyResolved(f, state));
  return hit?.file_path ?? null;
}

/** @returns {"all_theirs"|"all_mine"|"has_both"|"mixed"|"default"} */
export function summarizeResolutionChoices(files, state) {
  let mineCount = 0;
  let theirsCount = 0;
  let bothCount = 0;
  for (const file of files) {
    const entry = state[file.file_path];
    if (entry?.kind === "modify_delete") {
      if (entry.action === "keep_mine") mineCount += 1;
      if (entry.action === "keep_theirs") theirsCount += 1;
      if (entry.action === "keep_both") bothCount += 1;
    }
  }
  const total = mineCount + theirsCount + bothCount;
  if (total === 0) return "default";
  if (theirsCount > 0 && mineCount === 0 && bothCount === 0) return "all_theirs";
  if (mineCount > 0 && theirsCount === 0 && bothCount === 0) return "all_mine";
  if (bothCount > 0 && mineCount === 0 && theirsCount === 0) return "has_both";
  if (mineCount > 0 || theirsCount > 0 || bothCount > 0) return "mixed";
  return "default";
}

export function buildResolvedPayload(files, state) {
  return files.map((file) => {
    const path = file.file_path;
    const entry = state[path] || {};
    const kind = entry.kind ?? getConflictKind(file);

    if (kind === "modify_delete") {
      return {
        file_path: path,
        conflict_kind: "modify_delete",
        action: entry.action,
        shared_deleted: Boolean(file.shared_deleted),
        new_path: file.shared_path ?? null,
      };
    }

    if (kind === "rename") {
      const chosenPath = entry.chosenPath;
      const content =
        chosenPath === file.shared_path
          ? file.shared_content ?? file.content ?? ""
          : file.your_content ?? file.content ?? "";
      return {
        file_path: path,
        conflict_kind: "rename",
        action: "pick_path",
        chosen_path: chosenPath,
        content,
        related_paths: file.related_paths || [],
      };
    }

    const blocks = contentBlocksForFile(file);
    const choices = (entry.sectionChoices || []).slice(0, blocks.length);
    const normalized = blocks.map((_, idx) => choices[idx] || "my");
    return {
      file_path: path,
      conflict_kind: "content",
      content: buildResolvedContent(file.content || "", normalized),
    };
  });
}

export function allFilesResolvable(files, state) {
  return files.length > 0 && files.every((f) => {
    const kind = state[f.file_path]?.kind ?? getConflictKind(f);
    return kind !== "unknown" && isFileFullyResolved(f, state);
  });
}

/**
 * Apply a path choice to every rename conflict in state.
 * @param {"your"|"shared"} side
 */
export function applyRenamePathToAll(files, state, side) {
  const next = { ...state };
  for (const file of files) {
    if (getConflictKind(file) !== "rename") continue;
    const path = file.file_path;
    const chosenPath = side === "shared" ? file.shared_path : file.your_path;
    if (!chosenPath) continue;
    next[path] = { kind: "rename", chosenPath };
  }
  return next;
}

/** Apply a modify_delete action to every modify_delete conflict in state. */
export function applyModifyDeleteActionToAll(files, state, action) {
  if (!MODIFY_DELETE_ACTIONS.has(action)) return state;
  const next = { ...state };
  for (const file of files) {
    if (getConflictKind(file) !== "modify_delete") continue;
    next[file.file_path] = { kind: "modify_delete", action };
  }
  return next;
}
