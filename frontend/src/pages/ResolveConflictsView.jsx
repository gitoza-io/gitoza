import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FolderCog,
  LayoutTemplate,
  Ticket,
  Trash2,
} from "lucide-react";
import TreeContentLayout from "../components/TreeContentLayout";
import SidebarRow from "../components/SidebarRow";
import CaseRowLabel from "../components/CaseRowLabel";
import ModifyDeleteConflictPanel from "../components/ModifyDeleteConflictPanel";
import RenameConflictPanel from "../components/RenameConflictPanel";
import { TestCaseIcon, TestRunIcon, WikiPageIcon } from "../components/TestEntityIcons";
import { useConfirm } from "../components/ConfirmProvider";
import {
  CONFLICT_COLUMN_SHARED,
  CONFLICT_COLUMN_YOURS,
  CONFLICT_BULK_KEEP_MINE_ALL,
  CONFLICT_BULK_KEEP_SHARED_PATH,
  CONFLICT_BULK_KEEP_YOUR_PATH,
  CONFLICT_CONFIRM_ALL_MINE,
  CONFLICT_CONFIRM_ALL_THEIRS,
  CONFLICT_CONFIRM_DEFAULT,
  CONFLICT_CONFIRM_HAS_BOTH,
  CONFLICT_CONFIRM_MIXED,
  CONFLICT_CONTENT_SECTION_LABEL,
  CONFLICT_CONTINUE_BUTTON,
  CONFLICT_EMPTY_CONTENT,
  CONFLICT_KEEP_MINE,
  CONFLICT_KEEP_SHARED,
  CONFLICT_NO_CASES,
  CONFLICT_NO_CONFIG,
  CONFLICT_NO_RUNS,
  CONFLICT_NO_TEMPLATES,
  CONFLICT_NO_TICKETS,
  CONFLICT_NO_WIKI,
  CONFLICT_PAGE_TITLE,
  CONFLICT_PER_FILE_HELPER,
  CONFLICT_PROGRESS,
  CONFLICT_SAVING_BUTTON,
  CONFLICT_SECTION_LABEL,
  CONFLICT_SELECT_ITEM,
  CONFLICT_SIDEBAR_DELETE_BADGE,
  CONFLICT_SIDEBAR_RENAME_BADGE,
  CONFLICT_SIDEBAR_UNKNOWN_BADGE,
  CONFLICT_STRUCTURE_SECTION_LABEL,
  CONFLICT_UNPARSEABLE_FILE,
} from "../copy/conflictResolutionCopy";
import { SYNC_WORKFLOW_RESOLVE_BANNER } from "../copy/longOperationCopy";
import { getCaseDetail } from "../services/api";
import {
  caseMetaFromPath,
  isCaseFile,
  isConfigFile,
  isRunFile,
  isTemplateFile,
  isTicketFile,
  isWikiFile,
  runDisplayName,
  templateDisplayName,
  ticketDisplayName,
  wikiDisplayName,
} from "../utils/conflictEntityLabel";
import {
  allFilesResolvable,
  applyModifyDeleteActionToAll,
  applyRenamePathToAll,
  buildResolvedPayload,
  contentBlocksForFile,
  countModifyDeleteConflicts,
  countRenameConflicts,
  countResolvedFiles,
  createInitialResolverState,
  findFirstUnresolvedPath,
  getConflictKind,
  isFileFullyResolved,
  summarizeResolutionChoices,
} from "../utils/conflictResolution";

/** Matches `leading-5` / text-xs monospace row height used in conflict panes. */
const CONFLICT_LINE_HEIGHT_PX = 20;
/** Viewport shows conflict body plus 2 lines of context above and below. */
const CONTEXT_PAD_LINES = 2;
/** Cap so very large conflict bodies still fit the card. */
const CONFLICT_VIEWPORT_MAX_LINES = 40;

function countDisplayLines(text) {
  if (!text) return 0;
  const lines = String(text).split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.length - 1;
  }
  return lines.length;
}

function ConflictPane({
  title,
  headerClassName,
  bodyClassName,
  beforeContext,
  body,
  afterContext,
  emptyLabel,
}) {
  const scrollRef = useRef(null);
  const conflictRef = useRef(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const conflictLines = Math.max(1, countDisplayLines(body));
  const viewportLines = Math.min(conflictLines + CONTEXT_PAD_LINES * 2, CONFLICT_VIEWPORT_MAX_LINES);
  const maxHeightPx = viewportLines * CONFLICT_LINE_HEIGHT_PX;

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 1);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  // Scroll so the conflict body sits in view with ~2 context lines above.
  // Use layout + getBoundingClientRect: offsetTop is relative to offsetParent, not the scroll pane.
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    const conflictEl = conflictRef.current;
    if (!pane || !conflictEl) return;

    const paneRect = pane.getBoundingClientRect();
    const conflictRect = conflictEl.getBoundingClientRect();
    const conflictTopInContent = conflictRect.top - paneRect.top + pane.scrollTop;
    pane.scrollTop = Math.max(
      0,
      conflictTopInContent - CONTEXT_PAD_LINES * CONFLICT_LINE_HEIGHT_PX,
    );
    updateScrollButtons();
  }, [beforeContext, body, afterContext, updateScrollButtons]);

  const scrollByLine = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * CONFLICT_LINE_HEIGHT_PX, behavior: "smooth" });
  };

  return (
    <div className="min-w-0">
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-1 ${headerClassName}`}>
        <span className="text-xs font-medium">{title}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Scroll up"
            aria-label="Scroll up"
            disabled={!canScrollUp}
            onClick={() => scrollByLine(-1)}
            className="rounded p-0.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Scroll down"
            aria-label="Scroll down"
            disabled={!canScrollDown}
            onClick={() => scrollByLine(1)}
            className="rounded p-0.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateScrollButtons}
        className="overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maxHeight: maxHeightPx }}
      >
        <pre className="p-0 font-mono text-xs leading-5">
          {beforeContext ? (
            <div className="whitespace-pre-wrap break-words px-3 py-1 text-slate-400 dark:text-slate-500">
              {beforeContext}
            </div>
          ) : null}
          <div
            ref={conflictRef}
            className={`whitespace-pre-wrap break-words px-3 py-1 ${bodyClassName}`}
          >
            {body || emptyLabel}
          </div>
          {afterContext ? (
            <div className="whitespace-pre-wrap break-words px-3 py-1 text-slate-400 dark:text-slate-500">
              {afterContext}
            </div>
          ) : null}
        </pre>
      </div>
    </div>
  );
}

function ConflictBlock({ index, block, choice, onChoiceChange }) {
  const remoteSelected = choice === "remote";
  const mySelected = choice === "my";

  return (
    <div className="rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
          {CONFLICT_SECTION_LABEL(index)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onChoiceChange("my")}
            className={`rounded-ui px-2.5 py-1 text-xs font-medium ${
              mySelected
                ? "bg-indigo-600 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {CONFLICT_KEEP_MINE}
          </button>
          <button
            type="button"
            onClick={() => onChoiceChange("remote")}
            className={`rounded-ui px-2.5 py-1 text-xs font-medium ${
              remoteSelected
                ? "bg-indigo-600 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {CONFLICT_KEEP_SHARED}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700">
        <ConflictPane
          title={CONFLICT_COLUMN_SHARED}
          headerClassName="border-slate-200 bg-amber-50/70 text-amber-900 dark:border-slate-700 dark:bg-amber-500/10 dark:text-amber-200"
          bodyClassName="bg-amber-50/80 text-slate-800 dark:bg-amber-500/15 dark:text-slate-100"
          beforeContext={block.beforeContext || ""}
          body={block.remoteContent || ""}
          afterContext={block.afterContext || ""}
          emptyLabel={CONFLICT_EMPTY_CONTENT}
        />
        <ConflictPane
          title={CONFLICT_COLUMN_YOURS}
          headerClassName="border-slate-200 bg-blue-50/70 text-blue-900 dark:border-slate-700 dark:bg-blue-500/10 dark:text-blue-200"
          bodyClassName="bg-blue-50/80 text-slate-800 dark:bg-blue-500/15 dark:text-slate-100"
          beforeContext={block.beforeContext || ""}
          body={block.myContent || ""}
          afterContext={block.afterContext || ""}
          emptyLabel={CONFLICT_EMPTY_CONTENT}
        />
      </div>
    </div>
  );
}

function sidebarBadge(fileItem, state) {
  const kind = getConflictKind(fileItem);
  const resolved = isFileFullyResolved(fileItem, state);
  if (kind === "modify_delete") {
    return (
      <span className="ml-2 flex items-center gap-1">
        {resolved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
        <span className="rounded-ui bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">
          <Trash2 className="mr-0.5 inline h-3 w-3" />
          {CONFLICT_SIDEBAR_DELETE_BADGE}
        </span>
      </span>
    );
  }
  if (kind === "rename") {
    return (
      <span className="ml-2 flex items-center gap-1">
        {resolved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
        <span className="rounded-ui bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {CONFLICT_SIDEBAR_RENAME_BADGE}
        </span>
      </span>
    );
  }
  if (kind === "unknown") {
    return (
      <span className="ml-2 rounded-ui bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
        {CONFLICT_SIDEBAR_UNKNOWN_BADGE}
      </span>
    );
  }
  const blocks = contentBlocksForFile(fileItem);
  return (
    <span className="ml-2 flex items-center gap-1">
      {resolved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
      <span className="rounded-ui bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        {blocks.length}
      </span>
    </span>
  );
}

export default function ResolveConflictsView({
  repoSlug,
  conflictFileContents = [],
  message = "",
  loading = false,
  error = null,
  onResolve,
  sidebarFooter,
  sidebarTitleRight,
}) {
  const confirm = useConfirm();
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [resolverState, setResolverState] = useState({});
  const [caseMetaByPath, setCaseMetaByPath] = useState({});

  const caseFiles = useMemo(
    () => conflictFileContents.filter((f) => isCaseFile(f.file_path)),
    [conflictFileContents]
  );
  const runFiles = useMemo(
    () => conflictFileContents.filter((f) => isRunFile(f.file_path)),
    [conflictFileContents]
  );
  const templateFiles = useMemo(
    () => conflictFileContents.filter((f) => isTemplateFile(f.file_path)),
    [conflictFileContents]
  );
  const ticketFiles = useMemo(
    () => conflictFileContents.filter((f) => isTicketFile(f.file_path)),
    [conflictFileContents]
  );
  const wikiFiles = useMemo(
    () => conflictFileContents.filter((f) => isWikiFile(f.file_path)),
    [conflictFileContents]
  );
  const configFiles = useMemo(
    () => conflictFileContents.filter((f) => isConfigFile(f.file_path)),
    [conflictFileContents]
  );

  useEffect(() => {
    if (conflictFileContents.length === 0) return;

    const caseFilesLocal = conflictFileContents.filter((f) => isCaseFile(f.file_path));
    const runFilesLocal = conflictFileContents.filter((f) => isRunFile(f.file_path));
    const ticketFilesLocal = conflictFileContents.filter((f) => isTicketFile(f.file_path));
    const wikiFilesLocal = conflictFileContents.filter((f) => isWikiFile(f.file_path));
    const templateFilesLocal = conflictFileContents.filter((f) => isTemplateFile(f.file_path));
    const configFilesLocal = conflictFileContents.filter((f) => isConfigFile(f.file_path));

    const first =
      caseFilesLocal[0]?.file_path ||
      runFilesLocal[0]?.file_path ||
      ticketFilesLocal[0]?.file_path ||
      wikiFilesLocal[0]?.file_path ||
      templateFilesLocal[0]?.file_path ||
      configFilesLocal[0]?.file_path ||
      conflictFileContents[0]?.file_path ||
      null;
    setSelectedFilePath(first);
    setResolverState(createInitialResolverState(conflictFileContents));
  }, [conflictFileContents]);

  useEffect(() => {
    if (!repoSlug || caseFiles.length === 0) return;
    let cancelled = false;
    const fetchMeta = async () => {
      const next = {};
      await Promise.all(
        caseFiles.map(async (f) => {
          try {
            const detail = await getCaseDetail(f.file_path, repoSlug);
            if (cancelled) return;
            next[f.file_path] = { title: detail?.title ?? null, caseId: detail?.case_id ?? null };
          } catch {
            if (cancelled) return;
            next[f.file_path] = caseMetaFromPath(f.file_path);
          }
        })
      );
      if (!cancelled) setCaseMetaByPath((prev) => ({ ...prev, ...next }));
    };
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, [repoSlug, caseFiles]);

  const selectedFile = useMemo(
    () => conflictFileContents.find((f) => f.file_path === selectedFilePath) || null,
    [conflictFileContents, selectedFilePath]
  );

  const selectedKind = selectedFile ? getConflictKind(selectedFile) : null;
  const selectedEntry = selectedFilePath ? resolverState[selectedFilePath] : null;
  const selectedBlocks = useMemo(
    () => (selectedFile ? contentBlocksForFile(selectedFile) : []),
    [selectedFile]
  );

  const resolvedCount = countResolvedFiles(conflictFileContents, resolverState);
  const canContinue = allFilesResolvable(conflictFileContents, resolverState);
  const renameCount = countRenameConflicts(conflictFileContents);
  const modifyDeleteCount = countModifyDeleteConflicts(conflictFileContents);

  const applyBulkRenamePath = useCallback(
    (side) => {
      setResolverState((prev) => applyRenamePathToAll(conflictFileContents, prev, side));
    },
    [conflictFileContents]
  );

  const applyBulkModifyDelete = useCallback(
    (action) => {
      setResolverState((prev) => applyModifyDeleteActionToAll(conflictFileContents, prev, action));
    },
    [conflictFileContents]
  );

  const maybeAdvanceSelection = useCallback(
    (nextState) => {
      const currentFile = conflictFileContents.find((f) => f.file_path === selectedFilePath);
      if (currentFile && isFileFullyResolved(currentFile, nextState)) {
        const nextPath = findFirstUnresolvedPath(conflictFileContents, nextState);
        if (nextPath) setSelectedFilePath(nextPath);
      }
    },
    [conflictFileContents, selectedFilePath]
  );

  const updateResolverState = useCallback(
    (filePath, updater) => {
      setResolverState((prev) => {
        const next = { ...prev, [filePath]: updater(prev[filePath] || {}) };
        maybeAdvanceSelection(next);
        return next;
      });
    },
    [maybeAdvanceSelection]
  );

  const setChoiceForBlock = (filePath, blockIndex, value) => {
    updateResolverState(filePath, (entry) => {
      const choices = [...(entry.sectionChoices || [])];
      choices[blockIndex] = value;
      return { ...entry, sectionChoices: choices };
    });
  };

  const handleConfirm = async () => {
    if (!onResolve || !canContinue) return;
    const summary = summarizeResolutionChoices(conflictFileContents, resolverState);
    const messageBySummary = {
      all_theirs: CONFLICT_CONFIRM_ALL_THEIRS,
      all_mine: CONFLICT_CONFIRM_ALL_MINE,
      has_both: CONFLICT_CONFIRM_HAS_BOTH,
      mixed: CONFLICT_CONFIRM_MIXED,
      default: CONFLICT_CONFIRM_DEFAULT,
    };
    const ok = await confirm({
      title: "Continue sync?",
      message: messageBySummary[summary] || CONFLICT_CONFIRM_DEFAULT,
      confirmLabel: CONFLICT_CONTINUE_BUTTON,
      variant: summary === "all_theirs" || summary === "mixed" ? "danger" : "default",
    });
    if (!ok) return;
    onResolve(buildResolvedPayload(conflictFileContents, resolverState));
  };

  const renderFileRow = (fileItem, kind) => {
    const path = fileItem.file_path;
    const selected = path === selectedFilePath;
    const caseMeta = kind === "case" ? (caseMetaByPath[path] || caseMetaFromPath(path)) : null;

    return (
      <li key={path}>
        <SidebarRow
          selected={selected}
          onClick={() => setSelectedFilePath(path)}
          icon={
            kind === "run" ? (
              <TestRunIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            ) : kind === "ticket" ? (
              <Ticket className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            ) : kind === "wiki" ? (
              <WikiPageIcon />
            ) : kind === "template" ? (
              <LayoutTemplate className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : kind === "config" ? (
              <FolderCog className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            ) : (
              <TestCaseIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            )
          }
          label={
            kind === "run" ? (
              <span className="truncate text-sm">{runDisplayName(path)}</span>
            ) : kind === "ticket" ? (
              <span className="truncate text-sm">{ticketDisplayName(path)}</span>
            ) : kind === "wiki" ? (
              <span className="truncate text-sm">{wikiDisplayName(path)}</span>
            ) : kind === "template" ? (
              <span className="truncate text-sm">{templateDisplayName(path)}</span>
            ) : kind === "config" ? (
              <span className="truncate text-sm">Project config</span>
            ) : (
              <CaseRowLabel title={caseMeta.title || caseMeta.caseId} caseId={caseMeta.caseId} />
            )
          }
          right={sidebarBadge(fileItem, resolverState)}
        />
      </li>
    );
  };

  const showStructureSection =
    selectedKind === "modify_delete" || selectedKind === "rename";
  const showContentSection = selectedKind === "content";

  const sidebarContent = (
    <div className="flex min-h-0 flex-col gap-4 overflow-auto">
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Cases
        </div>
        {caseFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_CASES}</p>
        ) : (
          <ul className="m-0 list-none p-0">{caseFiles.map((f) => renderFileRow(f, "case"))}</ul>
        )}
      </div>
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Runs
        </div>
        {runFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_RUNS}</p>
        ) : (
          <ul className="m-0 list-none p-0">{runFiles.map((f) => renderFileRow(f, "run"))}</ul>
        )}
      </div>
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tickets
        </div>
        {ticketFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_TICKETS}</p>
        ) : (
          <ul className="m-0 list-none p-0">{ticketFiles.map((f) => renderFileRow(f, "ticket"))}</ul>
        )}
      </div>
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Wiki
        </div>
        {wikiFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_WIKI}</p>
        ) : (
          <ul className="m-0 list-none p-0">{wikiFiles.map((f) => renderFileRow(f, "wiki"))}</ul>
        )}
      </div>
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Templates
        </div>
        {templateFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_TEMPLATES}</p>
        ) : (
          <ul className="m-0 list-none p-0">{templateFiles.map((f) => renderFileRow(f, "template"))}</ul>
        )}
      </div>
      <div>
        <div className="shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Project config
        </div>
        {configFiles.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_NO_CONFIG}</p>
        ) : (
          <ul className="m-0 list-none p-0">{configFiles.map((f) => renderFileRow(f, "config"))}</ul>
        )}
      </div>
    </div>
  );

  return (
    <TreeContentLayout
      sidebarTitle={CONFLICT_PAGE_TITLE}
      sidebarTitleRight={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {conflictFileContents.length > 0 ? (
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {CONFLICT_PROGRESS(resolvedCount, conflictFileContents.length)}
            </span>
          ) : null}
          {renameCount > 1 ? (
            <>
              <button
                type="button"
                onClick={() => applyBulkRenamePath("your")}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {CONFLICT_BULK_KEEP_YOUR_PATH}
              </button>
              <button
                type="button"
                onClick={() => applyBulkRenamePath("shared")}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {CONFLICT_BULK_KEEP_SHARED_PATH}
              </button>
            </>
          ) : null}
          {modifyDeleteCount > 1 ? (
            <button
              type="button"
              onClick={() => applyBulkModifyDelete("keep_mine")}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {CONFLICT_BULK_KEEP_MINE_ALL}
            </button>
          ) : null}
          {sidebarTitleRight}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !canContinue}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? CONFLICT_SAVING_BUTTON : CONFLICT_CONTINUE_BUTTON}
          </button>
        </div>
      }
      sidebarContent={sidebarContent}
      sidebarFooter={sidebarFooter}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          {SYNC_WORKFLOW_RESOLVE_BANNER}
        </div>
        {message ? (
          <div className="shrink-0 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="shrink-0 flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}
        {!selectedFile ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{CONFLICT_SELECT_ITEM}</p>
        ) : (
          <>
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {isRunFile(selectedFile.file_path)
                  ? runDisplayName(selectedFile.file_path)
                  : isTicketFile(selectedFile.file_path)
                    ? ticketDisplayName(selectedFile.file_path)
                  : isWikiFile(selectedFile.file_path)
                    ? wikiDisplayName(selectedFile.file_path)
                  : isTemplateFile(selectedFile.file_path)
                    ? templateDisplayName(selectedFile.file_path)
                    : isConfigFile(selectedFile.file_path)
                      ? "Project config"
                      : caseMetaByPath[selectedFile.file_path]?.title ||
                        caseMetaFromPath(selectedFile.file_path).title}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{selectedFile.file_path}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {selectedKind === "unknown" ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{CONFLICT_UNPARSEABLE_FILE}</p>
              ) : (
                <div className="space-y-6">
                  {showStructureSection ? (
                    <section className="space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {CONFLICT_STRUCTURE_SECTION_LABEL}
                      </h3>
                      {selectedKind === "modify_delete" ? (
                        <ModifyDeleteConflictPanel
                          file={selectedFile}
                          action={selectedEntry?.action ?? null}
                          onActionChange={(action) =>
                            updateResolverState(selectedFile.file_path, (entry) => ({
                              ...entry,
                              kind: "modify_delete",
                              action,
                            }))
                          }
                        />
                      ) : null}
                      {selectedKind === "rename" ? (
                        <RenameConflictPanel
                          file={selectedFile}
                          chosenPath={selectedEntry?.chosenPath ?? null}
                          onChosenPathChange={(chosenPath) =>
                            updateResolverState(selectedFile.file_path, (entry) => ({
                              ...entry,
                              kind: "rename",
                              chosenPath,
                            }))
                          }
                        />
                      ) : null}
                    </section>
                  ) : null}

                  {showContentSection ? (
                    <section className="space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {CONFLICT_CONTENT_SECTION_LABEL}
                      </h3>
                      {selectedBlocks.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{CONFLICT_UNPARSEABLE_FILE}</p>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-sm text-slate-600 dark:text-slate-300">{CONFLICT_PER_FILE_HELPER}</p>
                          {selectedBlocks.map((block, idx) => (
                            <ConflictBlock
                              key={`${selectedFile.file_path}-${idx}`}
                              index={idx}
                              block={block}
                              choice={selectedEntry?.sectionChoices?.[idx] || "my"}
                              onChoiceChange={(value) =>
                                setChoiceForBlock(selectedFile.file_path, idx, value)
                              }
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </TreeContentLayout>
  );
}
