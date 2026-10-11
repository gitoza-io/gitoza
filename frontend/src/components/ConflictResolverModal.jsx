import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { GITOZA_WORK_BRANCH } from "../constants/git";
import { useConfirm } from "./ConfirmProvider";

/**
 * Parse Git conflict markers and return blocks for side-by-side view.
 * Left side = origin work branch (teammate's version), Right side = your draft (UI).
 * We preserve exact content (including newlines) so "Keep Main" yields byte-identical output.
 * Returns [{ mainContent, draftContent }, ...].
 */
function parseConflictBlocks(content) {
  const blocks = [];
  const markerStart = /<<<<<<< [^\n]*\n/;
  const markerMid = /\n=======\n/;
  const markerEnd = /\n>>>>>>> [^\n]*/;
  let rest = content;
  while (rest.length > 0) {
    const startIdx = rest.search(markerStart);
    if (startIdx === -1) break;
    const startMatch = rest.match(markerStart);
    const startLen = startMatch ? startMatch[0].length : 0;
    const afterStart = rest.slice(startIdx + startLen);
    const midIdx = afterStart.search(markerMid);
    if (midIdx === -1) break;
    const midMatch = afterStart.match(markerMid);
    const midLen = midMatch ? midMatch[0].length : 0;
    const firstPart = afterStart.slice(0, midIdx);
    const afterMid = afterStart.slice(midIdx + midLen);
    const endMatch = afterMid.match(markerEnd);
    if (!endMatch) break;
    const secondPart = afterMid.slice(0, endMatch.index);
    rest = afterMid.slice(endMatch.index + endMatch[0].length);
    blocks.push({ mainContent: firstPart, draftContent: secondPart });
  }
  return blocks;
}

/**
 * Build resolved file content by replacing conflict blocks with the chosen version.
 * choices: array of "main" | "draft" per block.
 * Preserves exact boundaries: no extra newline when the next part already starts with \n.
 */
function buildResolvedContent(content, choices) {
  const blocks = parseConflictBlocks(content);
  if (blocks.length === 0) return content;
  let result = "";
  let rest = content;
  const markerStart = /<<<<<<< [^\n]*\n/;
  const markerMid = /\n=======\n/;
  const markerEnd = /\n>>>>>>> [^\n]*/;
  for (let i = 0; i < blocks.length; i++) {
    const startIdx = rest.search(markerStart);
    if (startIdx === -1) break;
    result += rest.slice(0, startIdx);
    const startMatch = rest.match(markerStart);
    const startLen = startMatch ? startMatch[0].length : 0;
    let afterStart = rest.slice(startIdx + startLen);
    const midIdx = afterStart.search(markerMid);
    const midMatch = afterStart.match(markerMid);
    const midLen = midMatch ? midMatch[0].length : 0;
    afterStart = afterStart.slice(midIdx + midLen);
    const endMatch = afterStart.match(markerEnd);
    const restAfterBlock = afterStart.slice(endMatch.index + endMatch[0].length);
    const chosen = choices[i] === "main" ? blocks[i].mainContent : blocks[i].draftContent;
    result += chosen;
    if (restAfterBlock.length > 0 && !chosen.endsWith("\n") && !restAfterBlock.startsWith("\n")) {
      result += "\n";
    }
    rest = restAfterBlock;
  }
  result += rest;
  return result;
}

function ConflictBlock({ block, index, choice, onChoice }) {
  const mainSelected = choice === "main";
  const draftSelected = choice === "draft";
  return (
    <div className="rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
        Conflict {index + 1}
      </div>
      <div className="grid grid-cols-2 gap-0 divide-x divide-slate-200 dark:divide-slate-700">
        <div className="min-w-0">
          <div className="border-b border-slate-200 bg-amber-50/80 px-2 py-1 text-xs font-medium text-amber-800 dark:border-slate-700 dark:bg-amber-500/10 dark:text-amber-200">
            origin/{GITOZA_WORK_BRANCH} (Teammate&apos;s version)
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-slate-700 dark:text-slate-300">
            {block.mainContent || "(empty)"}
          </pre>
        </div>
        <div className="min-w-0">
          <div className="border-b border-slate-200 bg-blue-50/80 px-2 py-1 text-xs font-medium text-blue-800 dark:border-slate-700 dark:bg-blue-500/10 dark:text-blue-200">
            Your version (draft)
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-slate-700 dark:text-slate-300">
            {block.draftContent || "(empty)"}
          </pre>
        </div>
      </div>
      <div className="flex gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
        <button
          type="button"
          onClick={() => onChoice("main")}
          className={`inline-flex items-center gap-1.5 rounded-ui px-3 py-1.5 text-xs font-medium ${
            mainSelected
              ? "bg-blue-600 text-white opacity-100 font-bold"
              : "bg-slate-200 text-slate-500 opacity-50 line-through hover:opacity-70 dark:bg-slate-600 dark:text-slate-400"
          }`}
        >
          {mainSelected ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          Keep Main
        </button>
        <button
          type="button"
          onClick={() => onChoice("draft")}
          className={`inline-flex items-center gap-1.5 rounded-ui px-3 py-1.5 text-xs font-medium ${
            draftSelected
              ? "bg-blue-600 text-white opacity-100 font-bold"
              : "bg-slate-200 text-slate-500 opacity-50 line-through hover:opacity-70 dark:bg-slate-600 dark:text-slate-400"
          }`}
        >
          {draftSelected ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          Keep My Draft
        </button>
      </div>
    </div>
  );
}

function FileResolver({ filePath, content, resolvedChoices, onChoicesChange }) {
  const blocks = parseConflictBlocks(content);
  const choices = resolvedChoices.length >= blocks.length ? resolvedChoices : blocks.map(() => "draft");
  const allResolved = blocks.length === 0 || choices.every((c) => c !== null && c !== undefined);
  const updateChoice = (index, value) => {
    const next = [...choices];
    next[index] = value;
    onChoicesChange(next);
  };
  return (
    <div className="rounded-ui border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/70">
      <div className="border-b border-slate-200 px-4 py-2 font-mono text-sm font-medium text-slate-800 dark:border-slate-700 dark:text-slate-200">
        {filePath}
      </div>
      <div className="space-y-4 p-4">
        {blocks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No conflict markers found in this file.</p>
        ) : (
          blocks.map((block, idx) => (
            <ConflictBlock
              key={idx}
              block={block}
              index={idx}
              choice={choices[idx]}
              onChoice={(v) => updateChoice(idx, v)}
            />
          ))
        )}
      </div>
      {blocks.length > 0 && !allResolved && (
        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2 text-xs text-amber-700 dark:border-slate-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Resolve all conflict blocks above before continuing.
        </div>
      )}
    </div>
  );
}

export default function ConflictResolverModal({
  conflictFileContents = [],
  message = "",
  onResolve,
  onAbort,
  onClose,
  loading = false,
  error = null,
}) {
  const confirm = useConfirm();
  const [choicesPerFile, setChoicesPerFile] = useState(() =>
    conflictFileContents.map((f) => parseConflictBlocks(f.content).map(() => "draft"))
  );
  const [activeFileIndex, setActiveFileIndex] = useState(0);

  useEffect(() => {
    setChoicesPerFile(conflictFileContents.map((f) => parseConflictBlocks(f.content).map(() => "draft")));
    setActiveFileIndex(0);
  }, [conflictFileContents]);

  const currentFile = conflictFileContents[activeFileIndex];
  const blocksForCurrent = currentFile ? parseConflictBlocks(currentFile.content) : [];
  const currentChoices = (choicesPerFile[activeFileIndex] || []).length >= blocksForCurrent.length
    ? choicesPerFile[activeFileIndex]
    : [...(choicesPerFile[activeFileIndex] || []), ...blocksForCurrent.slice(choicesPerFile[activeFileIndex]?.length ?? 0).map(() => "draft")];

  const allFilesResolved = conflictFileContents.every((f, i) => {
    const blocks = parseConflictBlocks(f.content);
    const choices = choicesPerFile[i] || [];
    return blocks.length === 0 || (choices.length >= blocks.length && blocks.every((_, j) => choices[j] != null));
  });

  const handleChoicesChange = (choices) => {
    const next = [...choicesPerFile];
    next[activeFileIndex] = choices;
    setChoicesPerFile(next);
  };

  const handleContinue = async () => {
    if (!allFilesResolved || !onResolve) return;
    let keepMainCount = 0;
    let keepDraftCount = 0;
    conflictFileContents.forEach((f, i) => {
      const blocks = parseConflictBlocks(f.content);
      const choices = (choicesPerFile[i] || []).slice(0, blocks.length);
      choices.forEach((c) => {
        if (c === "main") keepMainCount += 1;
        else if (c === "draft") keepDraftCount += 1;
      });
    });
    let confirmMessage;
    if (keepDraftCount > 0 && keepMainCount === 0) {
      confirmMessage = "Are you sure? You are keeping your version and discarding the changes made by your teammate.";
    } else if (keepMainCount > 0 && keepDraftCount === 0) {
      confirmMessage = "Are you sure? You are keeping the remote (teammate's) version and discarding your draft.";
    } else {
      confirmMessage = "Are you sure? You are applying your chosen resolution (mix of remote and your version).";
    }
    const confirmed = await confirm({
      title: "Confirm resolution",
      description: confirmMessage,
      confirmLabel: "Continue",
      cancelLabel: "Cancel",
      variant: "default",
    });
    if (!confirmed) return;
    const resolvedFiles = conflictFileContents.map((f, i) => {
      const blocks = parseConflictBlocks(f.content);
      const choices = (choicesPerFile[i] || []).slice(0, blocks.length);
      const content = blocks.length ? buildResolvedContent(f.content, choices) : f.content;
      return { file_path: f.file_path, content };
    });
    onResolve(resolvedFiles);
  };

  if (!conflictFileContents?.length) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-ui border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">External changes detected</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A teammate modified this test case while you were editing. Please resolve the differences, then choose Cancel or Continue.
            </p>
          </div>
        </header>
        {message && (
          <p className="shrink-0 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">{message}</p>
        )}
        {error && (
          <div className="shrink-0 flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex min-h-0 shrink flex-1 gap-4 overflow-hidden p-4">
          <aside className="w-48 shrink-0 overflow-y-auto rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="p-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Files</div>
            {conflictFileContents.map((f, idx) => (
              <button
                key={f.file_path}
                type="button"
                onClick={() => setActiveFileIndex(idx)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  idx === activeFileIndex
                    ? "bg-indigo-100 font-medium text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"
                    : "text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {f.file_path}
              </button>
            ))}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {currentFile && (
              <FileResolver
                filePath={currentFile.file_path}
                content={currentFile.content}
                resolvedChoices={currentChoices}
                onChoicesChange={handleChoicesChange}
              />
            )}
          </div>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={onAbort}
            disabled={loading}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!allFilesResolved || loading}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white opacity-100 hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Continuing…" : "Continue"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export { parseConflictBlocks, buildResolvedContent };
