import { describe, expect, it } from "vitest";
import {
  allFilesResolvable,
  applyModifyDeleteActionToAll,
  applyRenamePathToAll,
  buildResolvedContent,
  buildResolvedPayload,
  createInitialResolverState,
  getConflictKind,
  isFileFullyResolved,
  normalizeLineEndings,
  parseConflictBlocks,
  summarizeResolutionChoices,
} from "./conflictResolution";

const LF_CONFLICT = [
  "prefix\n",
  "<<<<<<< HEAD\n",
  "remote line\n",
  "=======\n",
  "my line\n",
  ">>>>>>> branch\n",
  "suffix\n",
].join("");

const CRLF_CONFLICT = [
  "prefix\r\n",
  "<<<<<<< HEAD\r\n",
  "remote line\r\n",
  "=======\r\n",
  "my line\r\n",
  ">>>>>>> branch\r\n",
  "suffix\r\n",
].join("");

const CRLF_MULTI_CONFLICT = [
  "a\r\n",
  "<<<<<<< HEAD\r\n",
  "r1\r\n",
  "=======\r\n",
  "m1\r\n",
  ">>>>>>> b1\r\n",
  "mid\r\n",
  "<<<<<<< HEAD\r\n",
  "r2\r\n",
  "=======\r\n",
  "m2\r\n",
  ">>>>>>> b2\r\n",
  "z\r\n",
].join("");

/** Empty HEAD (shared) side + a second normal hunk — real ticket conflict shape. */
const EMPTY_HEAD_MULTI = [
  "---\n",
  "title: x\n",
  "<<<<<<< HEAD\n",
  "=======\n",
  "release: rms-1.1.2\n",
  ">>>>>>> auto-sync\n",
  "status: blocked\n",
  "<<<<<<< HEAD\n",
  "updated_at: newer\n",
  "=======\n",
  "updated_at: older\n",
  ">>>>>>> auto-sync\n",
  "---\n",
].join("");

/** Empty second side (yours empty during rebase). */
const EMPTY_THEIRS = [
  "prefix\n",
  "<<<<<<< HEAD\n",
  "shared line\n",
  "=======\n",
  ">>>>>>> branch\n",
  "suffix\n",
].join("");

/** results.md-shaped: case map key outside markers; result/time inside. */
const RESULTS_YAML_CONFLICT = [
  "run_id: RUN-1\n",
  "results:\n",
  "  .gitoza/test/cases/Demo/Suite/TC-100.md:\n",
  "<<<<<<< HEAD\n",
  "    result: failed\n",
  "    executed_at: \"2026-01-01T10:00:00Z\"\n",
  "=======\n",
  "    result: passed\n",
  "    executed_at: \"2026-01-01T11:00:00Z\"\n",
  ">>>>>>> auto-sync\n",
  "  .gitoza/test/cases/Demo/Suite/TC-101.md:\n",
  "    result: skipped\n",
].join("");

const RESULTS_YAML_MULTI = [
  "results:\n",
  "  .gitoza/test/cases/A/TC-1.md:\n",
  "<<<<<<< HEAD\n",
  "    result: failed\n",
  "=======\n",
  "    result: passed\n",
  ">>>>>>> auto-sync\n",
  "  .gitoza/test/cases/A/TC-2.md:\n",
  "<<<<<<< HEAD\n",
  "    result: passed\n",
  "=======\n",
  "    result: failed\n",
  ">>>>>>> auto-sync\n",
  "summary:\n",
  "  total: 2\n",
].join("");

describe("normalizeLineEndings", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("parseConflictBlocks", () => {
  it("parses LF markers (macOS-style): HEAD is shared during rebase", () => {
    const blocks = parseConflictBlocks(LF_CONFLICT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].remoteContent).toBe("remote line");
    expect(blocks[0].myContent).toBe("my line");
    expect(blocks[0].beforeContext).toBe("prefix");
    expect(blocks[0].afterContext).toBe("suffix");
  });

  it("parses CRLF markers (Windows-style): HEAD is shared during rebase", () => {
    const blocks = parseConflictBlocks(CRLF_CONFLICT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].remoteContent).toBe("remote line");
    expect(blocks[0].myContent).toBe("my line");
  });

  it("parses multiple CRLF conflict blocks", () => {
    const blocks = parseConflictBlocks(CRLF_MULTI_CONFLICT);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].remoteContent).toBe("r1");
    expect(blocks[0].myContent).toBe("m1");
    expect(blocks[1].remoteContent).toBe("r2");
    expect(blocks[1].myContent).toBe("m2");
    expect(blocks[0].beforeContext).toBe("a");
    expect(blocks[0].afterContext).toContain("mid");
    expect(blocks[1].beforeContext).toContain("mid");
    expect(blocks[1].afterContext).toBe("z");
  });

  it("parses empty-HEAD hunks as separate blocks (does not swallow later hunks)", () => {
    const blocks = parseConflictBlocks(EMPTY_HEAD_MULTI);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].remoteContent).toBe("");
    expect(blocks[0].myContent).toBe("release: rms-1.1.2");
    expect(blocks[1].remoteContent).toBe("updated_at: newer");
    expect(blocks[1].myContent).toBe("updated_at: older");
  });

  it("parses empty-theirs (empty yours) hunk", () => {
    const blocks = parseConflictBlocks(EMPTY_THEIRS);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].remoteContent).toBe("shared line");
    expect(blocks[0].myContent).toBe("");
  });

  it("attaches surrounding context for results.md-shaped hunks", () => {
    const blocks = parseConflictBlocks(RESULTS_YAML_CONFLICT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].remoteContent).toContain("result: failed");
    expect(blocks[0].myContent).toContain("result: passed");
    expect(blocks[0].beforeContext).toContain(".gitoza/test/cases/Demo/Suite/TC-100.md:");
    expect(blocks[0].afterContext).toContain(".gitoza/test/cases/Demo/Suite/TC-101.md:");
  });

  it("attaches distinct surrounding context per results.md hunk", () => {
    const blocks = parseConflictBlocks(RESULTS_YAML_MULTI);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].beforeContext).toContain("TC-1.md:");
    expect(blocks[1].beforeContext).toContain("TC-2.md:");
    expect(blocks[1].afterContext).toContain("summary:");
  });
});

describe("buildResolvedContent", () => {
  it("removes markers and keeps yours (non-HEAD) side when choice is my", () => {
    const resolved = buildResolvedContent(CRLF_CONFLICT, ["my"]);
    expect(resolved).toBe("prefix\nmy line\nsuffix\n");
    expect(resolved).not.toContain("<<<<<<<");
    expect(resolved).not.toContain("=======");
    expect(resolved).not.toContain(">>>>>>>");
  });

  it("keeps shared (HEAD) side when choice is remote", () => {
    const resolved = buildResolvedContent(CRLF_CONFLICT, ["remote"]);
    expect(resolved).toBe("prefix\nremote line\nsuffix\n");
  });

  it("resolves multiple CRLF blocks", () => {
    const resolved = buildResolvedContent(CRLF_MULTI_CONFLICT, ["remote", "my"]);
    expect(resolved).toBe("a\nr1\nmid\nm2\nz\n");
  });

  it("resolves empty-HEAD multi-block without leaving markers", () => {
    const resolved = buildResolvedContent(EMPTY_HEAD_MULTI, ["remote", "my"]);
    expect(resolved).toBe("---\ntitle: x\nstatus: blocked\nupdated_at: older\n---\n");
    expect(resolved).not.toContain("<<<<<<<");
    expect(resolved).not.toContain("=======");
    expect(resolved).not.toContain(">>>>>>>");
  });

  it("resolves empty-theirs hunk keeping shared side", () => {
    const resolved = buildResolvedContent(EMPTY_THEIRS, ["remote"]);
    expect(resolved).toBe("prefix\nshared line\nsuffix\n");
  });
});

describe("getConflictKind", () => {
  it("prefers API conflict_kind", () => {
    expect(getConflictKind({ conflict_kind: "modify_delete", content: "" })).toBe("modify_delete");
  });

  it("falls back to marker detection", () => {
    expect(getConflictKind({ content: LF_CONFLICT })).toBe("content");
  });

  it("returns unknown when no signal", () => {
    expect(getConflictKind({ content: "plain" })).toBe("unknown");
  });
});

describe("resolver state helpers", () => {
  const contentFile = {
    file_path: "a.md",
    conflict_kind: "content",
    content: LF_CONFLICT,
  };

  const deleteFile = {
    file_path: "b.md",
    conflict_kind: "modify_delete",
    shared_deleted: true,
    your_content: "mine",
    content: "",
  };

  const moveDeleteFile = {
    file_path: "old/b.md",
    conflict_kind: "modify_delete",
    shared_deleted: true,
    shared_path: "new/b.md",
    content: "",
  };

  it("createInitialResolverState defaults modify_delete to keep_mine", () => {
    const state = createInitialResolverState([contentFile, deleteFile]);
    expect(state["a.md"].kind).toBe("content");
    expect(state["b.md"]).toEqual({ kind: "modify_delete", action: "keep_mine" });
  });

  it("isFileFullyResolved accepts tri-state modify_delete actions", () => {
    const state = createInitialResolverState([deleteFile]);
    expect(isFileFullyResolved(deleteFile, state)).toBe(true);
    state["b.md"].action = "keep_both";
    expect(isFileFullyResolved(deleteFile, state)).toBe(true);
    state["b.md"].action = "keep_theirs";
    expect(isFileFullyResolved(deleteFile, state)).toBe(true);
    state["b.md"].action = "bogus";
    expect(isFileFullyResolved(deleteFile, state)).toBe(false);
  });

  it("buildResolvedPayload emits modify_delete tri-state without content", () => {
    const state = createInitialResolverState([deleteFile]);
    state["b.md"].action = "keep_theirs";
    const payload = buildResolvedPayload([deleteFile], state);
    expect(payload[0]).toMatchObject({
      file_path: "b.md",
      conflict_kind: "modify_delete",
      action: "keep_theirs",
      shared_deleted: true,
      new_path: null,
    });
    expect(payload[0].content).toBeUndefined();
  });

  it("buildResolvedPayload includes companion new_path from shared_path", () => {
    const state = createInitialResolverState([moveDeleteFile]);
    const payload = buildResolvedPayload([moveDeleteFile], state);
    expect(payload[0]).toMatchObject({
      file_path: "old/b.md",
      action: "keep_mine",
      new_path: "new/b.md",
    });
  });

  it("summarizeResolutionChoices detects mixed tri-state choices", () => {
    const f1 = { ...deleteFile, file_path: "b.md" };
    const f2 = { ...deleteFile, file_path: "c.md" };
    const state = createInitialResolverState([f1, f2]);
    state["b.md"].action = "keep_mine";
    state["c.md"].action = "keep_theirs";
    expect(summarizeResolutionChoices([f1, f2], state)).toBe("mixed");
  });

  it("summarizeResolutionChoices detects all_mine", () => {
    const state = createInitialResolverState([deleteFile]);
    expect(summarizeResolutionChoices([deleteFile], state)).toBe("all_mine");
  });

  it("allFilesResolvable requires every file resolved", () => {
    const state = createInitialResolverState([contentFile, deleteFile]);
    expect(allFilesResolvable([contentFile, deleteFile], state)).toBe(true);
  });

  const renameFile = {
    file_path: "your/case.md",
    conflict_kind: "rename",
    your_path: "your/case.md",
    shared_path: "shared/case.md",
    your_content: "same body",
    content: "same body",
  };

  it("createInitialResolverState defaults rename to your_path", () => {
    const state = createInitialResolverState([renameFile]);
    expect(state["your/case.md"]).toEqual({
      kind: "rename",
      chosenPath: "your/case.md",
    });
    expect(isFileFullyResolved(renameFile, state)).toBe(true);
    expect(allFilesResolvable([renameFile], state)).toBe(true);
  });

  it("buildResolvedPayload uses default your_path for rename", () => {
    const state = createInitialResolverState([renameFile]);
    const payload = buildResolvedPayload([renameFile], state);
    expect(payload[0]).toMatchObject({
      conflict_kind: "rename",
      chosen_path: "your/case.md",
      content: "same body",
    });
  });

  it("applyRenamePathToAll sets shared path on all rename files", () => {
    const f2 = { ...renameFile, file_path: "your/b.md", your_path: "your/b.md", shared_path: "shared/b.md" };
    const state = createInitialResolverState([renameFile, f2]);
    const next = applyRenamePathToAll([renameFile, f2], state, "shared");
    expect(next["your/case.md"].chosenPath).toBe("shared/case.md");
    expect(next["your/b.md"].chosenPath).toBe("shared/b.md");
  });

  it("applyModifyDeleteActionToAll sets action on all modify_delete files", () => {
    const f1 = { ...deleteFile, file_path: "b.md" };
    const f2 = { ...deleteFile, file_path: "c.md" };
    const state = createInitialResolverState([f1, f2]);
    const next = applyModifyDeleteActionToAll([f1, f2], state, "keep_both");
    expect(next["b.md"].action).toBe("keep_both");
    expect(next["c.md"].action).toBe("keep_both");
  });
});
