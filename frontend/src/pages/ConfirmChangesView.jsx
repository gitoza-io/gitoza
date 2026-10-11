import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderCog, LayoutTemplate, Loader2, File } from "lucide-react";
import SidebarSection from "../components/SidebarSection";
import ConfirmChangesChangelist from "../components/ConfirmChangesChangelist";
import ConfirmChangesTwoColumnLayout from "../components/ConfirmChangesTwoColumnLayout";
import { DiffViewer } from "../components/DiffViewer";
import { usePersistentViewActive } from "../components/PersistentView";
import { useConfirm } from "../components/ConfirmProvider";
import { useFetchedContent } from "../hooks/useFetchedContent";
import { TestCaseIcon, TestRunIcon, TicketTypeIcon, WikiPageIcon } from "../components/TestEntityIcons";
import { isTicketYamlPath, ticketLeafIdFromPath } from "../constants/ticketPaths";
import {
  isWikiGitkeepPath,
  isWikiTrackedPath,
  isWikiYamlPath,
  wikiBreadcrumbLabel,
  wikiGitkeepFolderLabel,
  wikiPageIdFromPath,
} from "../constants/wikiPaths";
import { LARGE_RUN_DIFF_BANNER_THRESHOLD } from "../constants/virtualDiffViewer";
import {
  discardPendingPaths,
  getFileDiff,
  getTicketDetail,
  getWikiPageDetail,
  getUnstagedDiffFiles,
  listRuns,
} from "../services/api";
import {
  CONFIRM_CHANGES_EMPTY_HINT,
  CONFIRM_CHANGES_EMPTY_TITLE,
  LARGE_RUN_DIFF_BANNER,
  SYNC_WORKFLOW_CONFIRM_BANNER,
} from "../copy/longOperationCopy";
import { filePath2Breadcrumb } from "../utils/breadcrumb";
import {
  buildConfirmChangelistEntries,
  discardTargetFromChangelistEntry,
  discardTargetFromSection,
  findFirstSelectableEntry,
} from "../utils/confirmChangesChangelist";
import {
  buildMergedRunDiff,
  formatRunGroupSubtitle,
  groupRunChangedFiles,
  parseRunTitleFromHeadDiff,
  runGroupFallbackLabel,
  shardLabelFromPath,
} from "../utils/confirmChangesRunGroups";

const CONFIRM_CHANGES_STORAGE_KEYS = {
  sidebarWidth: "confirmChanges.col.sidebarWidth",
};

const CASES_PREFIX = ".gitoza/test/cases/";
const RUNS_PREFIX = ".gitoza/test/runs/";
const TEMPLATES_PREFIX = ".gitoza/test/templates/";
const PROJECT_CONFIG_PATH = ".gitoza/config.json";

function normalizeRepoPath(path) {
  return (path || "").replace(/\\/g, "/");
}

function isRunFile(p) {
  return normalizeRepoPath(p).startsWith(RUNS_PREFIX);
}

function isCaseFile(p) {
  return normalizeRepoPath(p).startsWith(CASES_PREFIX);
}

function isTemplateFile(p) {
  return normalizeRepoPath(p).startsWith(TEMPLATES_PREFIX);
}

function isConfigFile(p) {
  return normalizeRepoPath(p) === PROJECT_CONFIG_PATH;
}

function isTicketFile(p) {
  return isTicketYamlPath(p);
}

function isWikiFile(p) {
  return isWikiTrackedPath(p);
}

function isKnownConfirmPath(p) {
  return (
    isCaseFile(p) ||
    isRunFile(p) ||
    isTemplateFile(p) ||
    isTicketFile(p) ||
    isWikiFile(p) ||
    isConfigFile(p)
  );
}

function templateDisplayName(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (normalized.startsWith(TEMPLATES_PREFIX)) {
    const base = normalized.split("/").pop() || normalized;
    return base.replace(/\.md$/i, "") || filePath;
  }
  return filePath;
}

function hasSnapshotData(snapshot) {
  if (!snapshot) return false;
  return (snapshot.files?.length ?? 0) > 0 || (snapshot.changes?.length ?? 0) > 0;
}

/**
 * Full-page "Confirm changes" view: two columns (flat changelist | diff).
 */
export default function ConfirmChangesView({
  repoSlug,
  /** @deprecated Confirm no longer uses repository tree; kept for App prop stability. */
  repositoryTree: _repositoryTree = [],
  /** Incremented by parent after each successful capture-pending-changes (reload snapshot even if view stays open). */
  captureEpoch = 0,
  /** Seeded from Sync capture response for instant changelist; reconciled with SQLite in background. */
  captureSnapshot = null,
  onConfirm,
  onCancel,
  /** Called when discard leaves no remaining paths (same cleanup as Cancel). */
  onAllDiscarded,
  /** Keep parent capture seed in sync after a successful discard. */
  onDiscardSnapshot,
  /** Parent sets workflowGitBusy while discard IPC runs. */
  onDiscardBusyChange,
  /** Report discard failures to the parent status banner. */
  onDiscardError,
  /** Notify parent when the Gitoza changelist is empty (disable Process). */
  onEmptyChange,
  sidebarFooter,
  sidebarTitleRight,
}) {
  const isActive = usePersistentViewActive();
  const confirm = useConfirm();
  const [changedFiles, setChangedFiles] = useState(() => captureSnapshot?.files ?? []);
  const [fileChanges, setFileChanges] = useState(() => captureSnapshot?.changes ?? []);
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [selectionKind, setSelectionKind] = useState("other");
  const [selectedRunDir, setSelectedRunDir] = useState(null);
  const [filesLoaded, setFilesLoaded] = useState(() => hasSnapshotData(captureSnapshot));
  /** Bumped after every reconcile so diff reloads when the selected path is unchanged but snapshot changed. */
  const [diffRefreshSeq, setDiffRefreshSeq] = useState(0);
  const [discardBusy, setDiscardBusy] = useState(false);

  const [runLabelsByDir, setRunLabelsByDir] = useState({});
  /** @type {[Record<string, { title: string, type: string, ticket_id: string }>, Function]} */
  const [ticketMetaByPath, setTicketMetaByPath] = useState({});
  /** @type {[Record<string, { title: string, page_id: string }>, Function]} */
  const [wikiMetaByPath, setWikiMetaByPath] = useState({});
  const pendingInitialSelectionRef = useRef(hasSnapshotData(captureSnapshot));
  const detailScrollRef = useRef(null);

  const caseChanges = useMemo(
    () => fileChanges.filter((c) => isCaseFile(c.path)),
    [fileChanges],
  );
  const ticketChanges = useMemo(
    () => fileChanges.filter((c) => isTicketFile(c.path)),
    [fileChanges],
  );
  const wikiChanges = useMemo(
    () => fileChanges.filter((c) => isWikiFile(c.path)),
    [fileChanges],
  );
  const runFiles = useMemo(() => changedFiles.filter(isRunFile), [changedFiles]);
  const runGroups = useMemo(() => groupRunChangedFiles(runFiles), [runFiles]);
  const templateFiles = useMemo(() => changedFiles.filter(isTemplateFile), [changedFiles]);
  const ticketFiles = useMemo(() => changedFiles.filter(isTicketFile), [changedFiles]);
  const wikiFiles = useMemo(() => changedFiles.filter(isWikiFile), [changedFiles]);
  const configFiles = useMemo(() => changedFiles.filter(isConfigFile), [changedFiles]);
  const otherFiles = useMemo(
    () => changedFiles.filter((p) => !isKnownConfirmPath(p)),
    [changedFiles],
  );
  const otherChanges = useMemo(
    () =>
      fileChanges.filter(
        (c) => c?.path && !isKnownConfirmPath(c.path),
      ),
    [fileChanges],
  );

  const ticketPathsForMeta = useMemo(() => {
    const set = new Set([
      ...ticketFiles.map((p) => (p || "").replace(/\\/g, "/")),
      ...ticketChanges.map((c) => (c?.path || "").replace(/\\/g, "/")).filter(Boolean),
    ]);
    return [...set].filter(isTicketYamlPath).sort();
  }, [ticketFiles, ticketChanges]);

  const wikiPathsForMeta = useMemo(() => {
    const set = new Set([
      ...wikiFiles.map((p) => (p || "").replace(/\\/g, "/")),
      ...wikiChanges.map((c) => (c?.path || "").replace(/\\/g, "/")).filter(Boolean),
    ]);
    return [...set].filter(isWikiYamlPath).sort();
  }, [wikiFiles, wikiChanges]);

  const changelistEntries = useMemo(
    () =>
      buildConfirmChangelistEntries({
        caseChanges,
        runGroups,
        templateFiles,
        ticketFiles,
        ticketChanges,
        ticketMetaByPath,
        wikiFiles,
        wikiChanges,
        wikiMetaByPath,
        configFiles,
        otherFiles,
        otherChanges,
        runLabelsByDir,
      }),
    [
      caseChanges,
      runGroups,
      templateFiles,
      ticketFiles,
      ticketChanges,
      ticketMetaByPath,
      wikiFiles,
      wikiChanges,
      wikiMetaByPath,
      configFiles,
      otherFiles,
      otherChanges,
      runLabelsByDir,
    ],
  );

  const hydrateRunLabelsFromDb = useCallback(
    async (groups) => {
      if (!repoSlug || !groups?.length) return;
      try {
        const runs = await listRuns(repoSlug, { includeArchived: true });
        const nameByRunId = new Map(
          (runs ?? [])
            .filter((r) => r?.run_id && r?.name?.trim())
            .map((r) => [r.run_id, r.name.trim()]),
        );
        const labels = {};
        for (const group of groups) {
          const name = nameByRunId.get(group.runId);
          if (name) labels[group.runDir] = name;
        }
        if (Object.keys(labels).length > 0) {
          setRunLabelsByDir((prev) => ({ ...labels, ...prev }));
        }
      } catch {
        // Best-effort; fallback label remains run id.
      }
    },
    [repoSlug],
  );

  const hydrateTicketMeta = useCallback(
    async (paths) => {
      if (!repoSlug || !paths?.length) {
        return {};
      }
      const results = await Promise.all(
        paths.map(async (path) => {
          const leaf = ticketLeafIdFromPath(path);
          try {
            const detail = await getTicketDetail(path, repoSlug);
            const ticketId = (detail?.ticket_id || leaf).trim() || leaf;
            const title = (detail?.title || ticketId).trim() || ticketId;
            const type = (
              detail?.type ||
              detail?.ticket_type ||
              "task"
            )
              .toString()
              .trim()
              .toLowerCase() || "task";
            return [path, { title, type, ticket_id: ticketId }];
          } catch {
            return [path, { title: leaf, type: "task", ticket_id: leaf }];
          }
        }),
      );
      return Object.fromEntries(results);
    },
    [repoSlug],
  );

  const hydrateWikiMeta = useCallback(
    async (paths) => {
      if (!repoSlug || !paths?.length) {
        return {};
      }
      const results = await Promise.all(
        paths.map(async (path) => {
          const leaf = wikiPageIdFromPath(path);
          try {
            const detail = await getWikiPageDetail(path, repoSlug);
            const pageId = (detail?.page_id || leaf).trim() || leaf;
            const title = (detail?.title || pageId).trim() || pageId;
            return [path, { title, page_id: pageId }];
          } catch {
            return [path, { title: leaf, page_id: leaf }];
          }
        }),
      );
      return Object.fromEntries(results);
    },
    [repoSlug],
  );

  useEffect(() => {
    let cancelled = false;
    if (!ticketPathsForMeta.length) {
      setTicketMetaByPath({});
      return undefined;
    }
    void hydrateTicketMeta(ticketPathsForMeta).then((next) => {
      if (!cancelled) setTicketMetaByPath(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrateTicketMeta, ticketPathsForMeta]);

  useEffect(() => {
    let cancelled = false;
    if (!wikiPathsForMeta.length) {
      setWikiMetaByPath({});
      return undefined;
    }
    void hydrateWikiMeta(wikiPathsForMeta).then((next) => {
      if (!cancelled) setWikiMetaByPath(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrateWikiMeta, wikiPathsForMeta]);

  const applyCaptureSnapshot = useCallback(
    (snapshot, { allowEmpty = false } = {}) => {
      if (!allowEmpty && !hasSnapshotData(snapshot)) return;
      const list = snapshot?.files ?? [];
      const changes = snapshot?.changes ?? [];
      setChangedFiles(list);
      setFileChanges(changes);
      setFilesLoaded(true);
      pendingInitialSelectionRef.current = true;
      setDiffRefreshSeq((s) => s + 1);
      const runPathsForHydrate = list.filter((p) => isRunFile(p));
      const groupsForHydrate = groupRunChangedFiles(runPathsForHydrate);
      if (groupsForHydrate.length > 0) {
        void hydrateRunLabelsFromDb(groupsForHydrate);
      }
    },
    [hydrateRunLabelsFromDb],
  );

  useEffect(() => {
    if (!hasSnapshotData(captureSnapshot)) return;
    applyCaptureSnapshot(captureSnapshot);
  }, [captureSnapshot, captureEpoch, applyCaptureSnapshot]);

  const reconcileFiles = useCallback(async () => {
    if (!repoSlug) return;
    const hasSeed = hasSnapshotData(captureSnapshot);
    if (!hasSeed) {
      setFilesLoaded(false);
      pendingInitialSelectionRef.current = true;
    }
    try {
      const snapshot = await getUnstagedDiffFiles(repoSlug);
      const list = snapshot?.files ?? [];
      setChangedFiles(list);
      setFileChanges(snapshot?.changes ?? []);
      const runPathsForHydrate = list.filter((p) => isRunFile(p));
      const groupsForHydrate = groupRunChangedFiles(runPathsForHydrate);
      if (groupsForHydrate.length > 0) {
        void hydrateRunLabelsFromDb(groupsForHydrate);
      }
    } catch {
      if (!hasSeed) {
        setChangedFiles([]);
        setFileChanges([]);
        pendingInitialSelectionRef.current = false;
        setSelectionKind("other");
        setSelectedFilePath(null);
        setSelectedRunDir(null);
      }
    } finally {
      setFilesLoaded(true);
      setDiffRefreshSeq((s) => s + 1);
    }
  }, [repoSlug, hydrateRunLabelsFromDb, captureSnapshot]);

  useEffect(() => {
    if (!pendingInitialSelectionRef.current || !filesLoaded) return;
    pendingInitialSelectionRef.current = false;
    const initial =
      findFirstSelectableEntry(changelistEntries) ?? {
        selectionKind: "other",
        selectedFilePath: null,
        selectedRunDir: null,
      };
    setSelectionKind(initial.selectionKind);
    setSelectedFilePath(initial.selectedFilePath);
    setSelectedRunDir(initial.selectedRunDir ?? null);
  }, [filesLoaded, changelistEntries]);

  const diffSelectionKey = useMemo(() => {
    if (!repoSlug) return null;
    if (selectionKind === "runGroup") {
      if (!selectedRunDir) return null;
      return `run:${selectedRunDir}\0${diffRefreshSeq}`;
    }
    if (!selectedFilePath) return null;
    return `file:${selectedFilePath}\0${diffRefreshSeq}`;
  }, [selectionKind, selectedRunDir, selectedFilePath, repoSlug, diffRefreshSeq]);

  const fetchDiffContent = useCallback(async () => {
    if (!repoSlug) return "";
    if (selectionKind === "runGroup" && selectedRunDir) {
      const group = runGroups.find((g) => g.runDir === selectedRunDir);
      if (!group) return "";
      const pairs = await Promise.all(
        group.paths.map(async (path) => ({
          path,
          diff: await getFileDiff(path, repoSlug).catch(() => ""),
        })),
      );
      const headPair = pairs.find((p) => shardLabelFromPath(p.path) === "head");
      const title = headPair ? parseRunTitleFromHeadDiff(headPair.diff) : null;
      if (title) {
        setRunLabelsByDir((prev) => ({ ...prev, [selectedRunDir]: title }));
      }
      return buildMergedRunDiff(pairs);
    }
    if (selectedFilePath) {
      return (await getFileDiff(selectedFilePath, repoSlug).catch(() => "")) ?? "";
    }
    return "";
  }, [repoSlug, selectionKind, selectedRunDir, selectedFilePath, runGroups]);

  const [diffContent, diffContentKey] = useFetchedContent(diffSelectionKey, fetchDiffContent);
  const diffLoading = diffSelectionKey != null && diffContentKey !== diffSelectionKey;
  const displayDiffContent = diffContent ?? "";

  useEffect(() => {
    if (!isActive || !repoSlug) return;
    reconcileFiles();
  }, [isActive, repoSlug, captureEpoch, reconcileFiles]);

  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedFilePath, selectedRunDir]);

  const diffLineCount = useMemo(
    () =>
      diffContentKey === diffSelectionKey && displayDiffContent
        ? displayDiffContent.split("\n").length
        : 0,
    [diffContentKey, diffSelectionKey, displayDiffContent],
  );

  const selectedRunGroup = useMemo(
    () => runGroups.find((g) => g.runDir === selectedRunDir) ?? null,
    [runGroups, selectedRunDir],
  );

  const showLargeRunDiffBanner =
    diffContentKey === diffSelectionKey &&
    !diffLoading &&
    selectionKind === "runGroup" &&
    selectedRunDir != null &&
    diffLineCount >= LARGE_RUN_DIFF_BANNER_THRESHOLD;

  const hasDetailSelection =
    (selectionKind === "runGroup" && selectedRunDir != null) ||
    (selectionKind !== "runGroup" && selectedFilePath != null);

  const handleSelectOther = useCallback((filePath) => {
    setSelectionKind("other");
    setSelectedRunDir(null);
    setSelectedFilePath(filePath);
  }, []);

  const handleSelectRunGroup = useCallback((runDir) => {
    setSelectionKind("runGroup");
    setSelectedFilePath(null);
    setSelectedRunDir(runDir);
  }, []);

  const handleSelectCase = useCallback((filePath) => {
    setSelectionKind("caseFolder");
    setSelectedRunDir(null);
    setSelectedFilePath(filePath);
  }, []);

  const setDiscardBusyState = useCallback(
    (busy) => {
      setDiscardBusy(busy);
      onDiscardBusyChange?.(busy);
    },
    [onDiscardBusyChange],
  );

  const runDiscard = useCallback(
    async ({ paths, changes, title, description }) => {
      if (!repoSlug || !paths?.length || discardBusy) return;
      const ok = await confirm({
        title,
        description,
        confirmLabel: "Discard",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!ok) return;

      setDiscardBusyState(true);
      try {
        const snapshot = await discardPendingPaths(repoSlug, { paths, changes });
        const remainingFiles = snapshot?.files ?? [];
        applyCaptureSnapshot(snapshot, { allowEmpty: true });
        onDiscardSnapshot?.(snapshot);

        const remainingSet = new Set(remainingFiles.map((p) => (p || "").replace(/\\/g, "/")));
        if (selectionKind === "runGroup" && selectedRunDir) {
          const stillPresent = remainingFiles.some((p) => {
            const norm = (p || "").replace(/\\/g, "/");
            return (
              isRunFile(norm) &&
              (norm === selectedRunDir ||
                norm.startsWith(`${selectedRunDir}/`))
            );
          });
          if (!stillPresent) {
            setSelectedRunDir(null);
            setSelectedFilePath(null);
            setSelectionKind("other");
          }
        } else if (selectedFilePath) {
          const sel = selectedFilePath.replace(/\\/g, "/");
          if (!remainingSet.has(sel)) {
            setSelectedFilePath(null);
            setSelectedRunDir(null);
            setSelectionKind("other");
          }
        }

        if (remainingFiles.length === 0) {
          onAllDiscarded?.();
        }
      } catch (err) {
        const msg = err?.message ?? "Failed to discard changes";
        const text = Array.isArray(msg) ? msg.join(", ") : String(msg);
        onDiscardError?.(text);
      } finally {
        setDiscardBusyState(false);
      }
    },
    [
      repoSlug,
      discardBusy,
      confirm,
      setDiscardBusyState,
      applyCaptureSnapshot,
      selectionKind,
      selectedRunDir,
      selectedFilePath,
      onAllDiscarded,
      onDiscardSnapshot,
      onDiscardError,
    ],
  );

  const handleDiscardEntry = useCallback(
    async (entry) => {
      const target = discardTargetFromChangelistEntry(entry);
      if (!target) return;
      const isRun = entry.kind === "runGroup";
      await runDiscard({
        paths: target.paths,
        changes: target.changes,
        title: isRun ? "Discard run changes?" : "Discard changes?",
        description: isRun
          ? `Discard all changes for run "${target.label}"? This cannot be undone.`
          : `Discard changes in "${target.label}"? This cannot be undone.`,
      });
    },
    [runDiscard],
  );

  const handleDiscardSection = useCallback(
    async (sectionId) => {
      const target = discardTargetFromSection(changelistEntries, sectionId);
      if (!target) return;
      await runDiscard({
        paths: target.paths,
        changes: target.changes,
        title: `Discard ${target.label} changes?`,
        description: `Discard all changes in ${target.label}? (${target.itemCount} items) This cannot be undone.`,
      });
    },
    [changelistEntries, runDiscard],
  );

  const snapshotReady = filesLoaded || hasSnapshotData(captureSnapshot);

  const hasAnyChanges =
    caseChanges.length > 0 ||
    runFiles.length > 0 ||
    ticketFiles.length > 0 ||
    ticketChanges.length > 0 ||
    wikiFiles.length > 0 ||
    wikiChanges.length > 0 ||
    templateFiles.length > 0 ||
    configFiles.length > 0 ||
    otherFiles.length > 0 ||
    otherChanges.length > 0;
  const isEmpty = snapshotReady && !hasAnyChanges;

  useEffect(() => {
    onEmptyChange?.(isEmpty);
    return () => {
      onEmptyChange?.(false);
    };
  }, [isEmpty, onEmptyChange]);

  const detailContent =
    diffSelectionKey && diffLoading && !diffContent ? (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    ) : (
      <DiffViewer content={displayDiffContent} parentScrollRef={detailScrollRef} />
    );

  const detailColumn = isEmpty ? (
    <div className="flex flex-col gap-4 p-6">
      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        {SYNC_WORKFLOW_CONFIRM_BANNER}
      </div>
      <div className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-300">
          {CONFIRM_CHANGES_EMPTY_TITLE}
        </p>
        <p>{CONFIRM_CHANGES_EMPTY_HINT}</p>
      </div>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        {SYNC_WORKFLOW_CONFIRM_BANNER}
      </div>
      {hasDetailSelection ? (
        <>
          <div className="shrink-0 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 dark:border-slate-700 dark:bg-slate-900/60">
            {selectionKind === "runGroup" ? (
              <TestRunIcon className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            ) : isTicketFile(selectedFilePath) ? (
              <TicketTypeIcon
                type={
                  ticketMetaByPath[(selectedFilePath || "").replace(/\\/g, "/")]?.type || "task"
                }
              />
            ) : isWikiFile(selectedFilePath) ? (
              <WikiPageIcon />
            ) : isTemplateFile(selectedFilePath) ? (
              <LayoutTemplate className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            ) : isConfigFile(selectedFilePath) ? (
              <FolderCog className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            ) : isCaseFile(selectedFilePath) ? (
              <TestCaseIcon className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            ) : (
              <File className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            )}
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
              {diffLoading && diffContent ? (
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400 dark:text-slate-500"
                  aria-hidden
                />
              ) : null}
              {selectionKind === "runGroup" && selectedRunGroup ? (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {runLabelsByDir[selectedRunGroup.runDir] ??
                      runGroupFallbackLabel(selectedRunGroup.runDir)}
                  </span>
                  <span className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                    {formatRunGroupSubtitle(selectedRunGroup.paths)}
                    {selectedRunGroup.runId ? ` · ${selectedRunGroup.runId}` : ""}
                  </span>
                </span>
              ) : isTicketFile(selectedFilePath) ? (
                ticketMetaByPath[(selectedFilePath || "").replace(/\\/g, "/")]?.title ||
                ticketLeafIdFromPath(selectedFilePath)
              ) : isWikiFile(selectedFilePath) ? (
                isWikiGitkeepPath(selectedFilePath)
                  ? wikiGitkeepFolderLabel(selectedFilePath)
                  : wikiMetaByPath[(selectedFilePath || "").replace(/\\/g, "/")]?.title ||
                    wikiBreadcrumbLabel(selectedFilePath)
              ) : isTemplateFile(selectedFilePath) ? (
                templateDisplayName(selectedFilePath)
              ) : isConfigFile(selectedFilePath) ? (
                "Project config"
              ) : isCaseFile(selectedFilePath) ? (
                filePath2Breadcrumb(selectedFilePath).join(" › ")
              ) : (
                (selectedFilePath || "").replace(/\\/g, "/")
              )}
            </span>
          </div>
          {showLargeRunDiffBanner ? (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
              {LARGE_RUN_DIFF_BANNER}
            </div>
          ) : null}
          <div
            ref={detailScrollRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            {detailContent}
          </div>
        </>
      ) : (
        <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
          Select a case, run, ticket, wiki page, template, or project config to view its changes.
        </p>
      )}
    </div>
  );

  const sidebarColumn = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <SidebarSection title="Confirm changes" titleRight={sidebarTitleRight} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConfirmChangesChangelist
          entries={changelistEntries}
          selectionKind={selectionKind}
          selectedCasePath={selectedFilePath}
          selectedRunDir={selectedRunDir}
          selectedOtherPath={selectedFilePath}
          onSelectCase={handleSelectCase}
          onSelectRunGroup={handleSelectRunGroup}
          onSelectOther={handleSelectOther}
          onDiscardEntry={handleDiscardEntry}
          onDiscardSection={handleDiscardSection}
          discardDisabled={discardBusy}
          loading={!snapshotReady}
        />
      </div>
      {sidebarFooter != null ? (
        <div
          data-sidebar-footer
          className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
        >
          {sidebarFooter}
        </div>
      ) : null}
    </div>
  );

  return (
    <ConfirmChangesTwoColumnLayout
      storageKeys={CONFIRM_CHANGES_STORAGE_KEYS}
      sidebarColumn={sidebarColumn}
      detailColumn={detailColumn}
    />
  );
}
