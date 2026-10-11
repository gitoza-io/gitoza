import { useState, useEffect, useRef, useCallback } from "react";
import CommentStream from "./CommentStream";
import { useGitUserName } from "../hooks/useGitUserName";
import { Pencil, Eye } from "lucide-react";
import UpdatedByLine from "./UpdatedByLine";
import MarkdownToolbar from "./MarkdownToolbar";
import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import BodyMarkdownEditor from "./BodyMarkdownEditor";
import { renderMarkdown } from "./TestCaseDetailModal";
import DetailPanel from "./DetailPanel";
import Tooltip from "./Tooltip";
import ApproveStatusBadge from "./ApproveStatusBadge";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";
import AssigneeInput from "./AssigneeInput";
import TicketIdsInput from "./TicketIdsInput";
import TicketIdTitleList from "./TicketIdTitleList";
import TicketReleaseInput from "./TicketReleaseInput";
import { normalizeRequirementIds, mergeRunCoversFromCases, enrichCasesRequirementIdsFromLive } from "../utils/requirementIds";
import { fetchAllRunCases, getCaseDetail } from "../services/api";
import RunBreakdownStats from "./RunBreakdownStats";
import { formatReleaseLabel, resolveReleaseById } from "../utils/releaseLinks";

const normalizeRunDraft = (d) => ({
  description: (d.description || "").trim(),
  assigned_to: (d.assignedTo || "").trim(),
  requirement_ids: normalizeRequirementIds(d.requirementIds ?? d.requirement_ids).join("\n"),
  release: (d.release || "").trim(),
});

function normalizeReleaseValue(v) {
  return (v || "").trim();
}

/** Read-only release chip with optional navigation. */
function RunReleaseView({ releaseId, repoSlug, onNavigateToRelease = null }) {
  const [row, setRow] = useState(undefined);
  const id = normalizeReleaseValue(releaseId);

  useEffect(() => {
    if (!id || !repoSlug) {
      setRow(null);
      return undefined;
    }
    let cancelled = false;
    resolveReleaseById(repoSlug, id).then((r) => {
      if (!cancelled) setRow(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, repoSlug]);

  if (!id) return null;

  const resolved = row && row.release_id;
  const loading = row === undefined;
  const label = resolved ? formatReleaseLabel(row) : id;

  let content;
  if (resolved && onNavigateToRelease) {
    content = (
      <button
        type="button"
        onClick={() => onNavigateToRelease(id)}
        className="text-sm font-semibold text-indigo-600 underline decoration-indigo-400/60 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        {label}
      </button>
    );
  } else {
    content = (
      <span
        className={`text-sm font-semibold ${
          loading
            ? "text-slate-400"
            : resolved
              ? "text-slate-800 dark:text-slate-100"
              : "font-mono text-amber-700 dark:text-amber-400"
        }`}
      >
        {label}
      </span>
    );
  }

  return (
    <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Release{" "}
      </span>
      {content}
    </p>
  );
}

/** Prominent result summary: passed / failed / skipped / pending with color. */
function RunResultSummary({ run }) {
  const total = run?.total_cases ?? 0;
  const passed = run?.passed ?? 0;
  const failed = run?.failed ?? 0;
  const skipped = run?.skipped ?? 0;
  const pending = Math.max(0, total - passed - failed - skipped);
  if (total === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="rounded-ui bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
        {passed} passed
      </span>
      <span className="rounded-ui bg-red-100 px-2.5 py-1 text-sm font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-300">
        {failed} failed
      </span>
      {skipped > 0 && (
        <span className="rounded-ui bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
          {skipped} skipped
        </span>
      )}
      {pending > 0 && (
        <span className="rounded-ui bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
          {pending} pending
        </span>
      )}
    </div>
  );
}

/**
 * Shared run summary panel with View / Edit mode (matching CaseEditorPanel pattern).
 * View: run name, description, comments.
 * Edit: editable description and assignee with debounced auto-save. Eye flushes pending draft before view mode.
 */
function RunSummaryPanel({
  run,
  runCases: _runCases = [],
  loading: _loading = false,
  statusBadge = null,
  reviewEnabled = true,
  footer = null,
  readOnly = false,
  isEditing = false,
  onToggleEdit,
  onSaveRun,
  onPostRunComment,
  onDeleteRunComment,
  repoSlug = null,
  gitProfileVersion = 0,
  allUsernames = null,
  onOpenTicket = null,
  onNavigateToRelease = null,
}) {
  const [localDesc, setLocalDesc] = useState("");
  const [localAssignedTo, setLocalAssignedTo] = useState("");
  const [localRequirementIds, setLocalRequirementIds] = useState([]);
  const [localRelease, setLocalRelease] = useState("");
  const [error, setError] = useState("");
  const [measuredDescHeight, setMeasuredDescHeight] = useState(null);
  const [commentPosting, setCommentPosting] = useState(false);
  const [addingFromCases, setAddingFromCases] = useState(false);
  const gitUserName = useGitUserName(repoSlug, gitProfileVersion);

  const prevRunKeyRef = useRef(null);
  const prevDescRef = useRef(null);
  const prevAssignedRef = useRef(null);
  const prevReqRef = useRef(null);
  const prevReleaseRef = useRef(null);
  const descriptionEditRef = useRef(null);
  const descMeasureRef = useRef(null);

  useEffect(() => {
    if (isEditing && descriptionEditRef.current) {
      descriptionEditRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isEditing]);

  useEffect(() => {
    if (!run) return;
    const initKey = run.run_id;
    const serverReq = normalizeRequirementIds(run);
    const serverRelease = normalizeReleaseValue(run.release);
    if (initKey !== prevRunKeyRef.current) {
      prevRunKeyRef.current = initKey;
      prevDescRef.current = run.description;
      prevAssignedRef.current = run.assigned_to;
      prevReqRef.current = serverReq.join("\n");
      prevReleaseRef.current = serverRelease;
      setLocalDesc(run.description || "");
      setLocalAssignedTo(run.assigned_to || "");
      setLocalRequirementIds(serverReq);
      setLocalRelease(serverRelease);
      setError("");
      return;
    }
    if (isEditing && run.description !== prevDescRef.current && localDesc === (prevDescRef.current ?? "")) {
      prevDescRef.current = run.description;
      setLocalDesc(run.description || "");
    }
    if (isEditing && run.assigned_to !== prevAssignedRef.current && localAssignedTo === (prevAssignedRef.current ?? "")) {
      prevAssignedRef.current = run.assigned_to;
      setLocalAssignedTo(run.assigned_to || "");
    }
    const serverReqKey = serverReq.join("\n");
    if (
      isEditing &&
      serverReqKey !== prevReqRef.current &&
      normalizeRequirementIds(localRequirementIds).join("\n") === (prevReqRef.current ?? "")
    ) {
      prevReqRef.current = serverReqKey;
      setLocalRequirementIds(serverReq);
    }
    if (
      isEditing &&
      serverRelease !== prevReleaseRef.current &&
      normalizeReleaseValue(localRelease) === (prevReleaseRef.current ?? "")
    ) {
      prevReleaseRef.current = serverRelease;
      setLocalRelease(serverRelease);
    }
  }, [isEditing, run, localDesc, localAssignedTo, localRequirementIds, localRelease]);

  useEffect(() => {
    if (!isEditing) {
      prevRunKeyRef.current = null;
      prevDescRef.current = null;
      prevAssignedRef.current = null;
      prevReqRef.current = null;
      prevReleaseRef.current = null;
      setMeasuredDescHeight(null);
    }
  }, [isEditing]);

  // When switching to edit mode, measure description text height with a hidden textarea then set editor height (same fix as CaseEditorPanel).
  useEffect(() => {
    if (!isEditing || !descMeasureRef.current) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled && descMeasureRef.current) {
          setMeasuredDescHeight(descMeasureRef.current.scrollHeight);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [isEditing, localDesc]);

  const runDraft = {
    description: localDesc,
    assignedTo: localAssignedTo,
    requirementIds: localRequirementIds,
    release: localRelease,
  };
  const persistedRunDraft = {
    description: run?.description || "",
    assignedTo: run?.assigned_to || "",
    requirementIds: normalizeRequirementIds(run),
    release: normalizeReleaseValue(run?.release),
  };

  const handleAutoSaveRun = useCallback(
    async (draft, runIdFromHook) => {
      setError("");
      const runId = runIdFromHook ?? run?.run_id;
      if (!runId) return;
      try {
        await onSaveRun?.({
          description: (draft.description || "").trim(),
          assigned_to: (draft.assignedTo || "").trim(),
          requirement_ids: normalizeRequirementIds(draft.requirementIds),
          release: normalizeReleaseValue(draft.release),
          run_id: runId,
        });
      } catch (err) {
        setError(err?.response?.data?.detail || err?.message || "Failed to save");
      }
    },
    [onSaveRun, run],
  );

  const { flush } = useDebouncedAutoSave({
    enabled: isEditing && !!run && !readOnly,
    key: run?.run_id,
    draft: runDraft,
    persisted: persistedRunDraft,
    normalize: normalizeRunDraft,
    save: handleAutoSaveRun,
    delayMs: DEBOUNCE_MS,
    silent: true,
  });

  useEffect(() => {
    return registerAutoSaveFlush(flush);
  }, [flush]);

  const handleAddFromCases = useCallback(async () => {
    if (!run?.run_id || addingFromCases) return;
    setAddingFromCases(true);
    setError("");
    try {
      // Always fetch full run-case list — cached panel rows often omit requirement_ids.
      const cases = await fetchAllRunCases(run.run_id, repoSlug);
      // Run-case SQLite snapshots often have empty requirement_id; resolve from live cases.
      const enriched = await enrichCasesRequirementIdsFromLive(cases, (fp) =>
        getCaseDetail(fp, repoSlug),
      );
      const merged = mergeRunCoversFromCases(localRequirementIds, enriched);
      const mergedKey = merged.join("\n");
      const currentKey = normalizeRequirementIds(localRequirementIds).join("\n");
      if (mergedKey === currentKey) {
        return;
      }
      setLocalRequirementIds(merged);
      prevReqRef.current = mergedKey;
      await onSaveRun?.({
        description: (localDesc || "").trim(),
        assigned_to: (localAssignedTo || "").trim(),
        requirement_ids: merged,
        release: normalizeReleaseValue(localRelease),
        run_id: run.run_id,
      });
    } catch (err) {
      setError(err?.message || "Failed to load cases for this run");
    } finally {
      setAddingFromCases(false);
    }
  }, [
    run?.run_id,
    localRequirementIds,
    localDesc,
    localAssignedTo,
    localRelease,
    repoSlug,
    addingFromCases,
    onSaveRun,
  ]);

  const handlePostComment = useCallback(
    async (text) => {
      if (!run?.run_id || !onPostRunComment) return;
      setCommentPosting(true);
      try {
        await onPostRunComment(run.run_id, text);
      } finally {
        setCommentPosting(false);
      }
    },
    [run?.run_id, onPostRunComment],
  );

  const handleDeleteComment = useCallback(
    async (index) => {
      if (!run?.run_id || !onDeleteRunComment) return;
      await onDeleteRunComment(run.run_id, index);
    },
    [run?.run_id, onDeleteRunComment],
  );

  const commentBlock = run ? (
    <CommentStream
      comments={run.comments ?? []}
      currentAuthor={gitUserName}
      onPost={onPostRunComment && !readOnly ? handlePostComment : undefined}
      onDelete={onDeleteRunComment && !readOnly ? handleDeleteComment : undefined}
      disabled={readOnly}
      posting={commentPosting}
    />
  ) : null;

  const { toolbarProps, getLiveEditorProps } = useMarkdownEditor(localDesc, setLocalDesc, {
    onBlur: () => flush(),
    growWithContent: true,
    initialHeight: measuredDescHeight ?? undefined,
    livePreview: true,
    repoSlug,
  });

  if (!run) return null;

  const viewRequirementIds = normalizeRequirementIds(run);

  const subtitle = (run.updated_at || run.updated_by) ? (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <UpdatedByLine updatedAt={run.updated_at} updatedBy={run.updated_by} />
    </p>
  ) : null;

  // ─── Edit mode: sticky toolbar, only description body scrolls (same pattern as Case) ───
  if (isEditing && !readOnly) {
    const descEditorProps = getLiveEditorProps({
      placeholder: "Add a description… (Markdown supported)",
      "aria-label": "Run description (Markdown)",
      className:
        "min-h-[7.5rem] w-full overflow-y-hidden resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500",
      measureRef: descMeasureRef,
    });

    return (
      <DetailPanel
        title={run.name}
        statusBadge={
          statusBadge ?? (
            <ApproveStatusBadge status={run.approve_status} entityType="run" reviewEnabled={reviewEnabled} />
          )
        }
        subtitle={subtitle}
        headerExtra={
          <div className="flex items-center gap-2">
            <Tooltip label="View" placement="bottom-end">
              <button
                type="button"
                onClick={async () => {
                  await flush();
                  onToggleEdit?.(false);
                }}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="View"
              >
                <Eye className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        }
        footer={footer}
        bodyScroll={false}
      >
        <div ref={descriptionEditRef} className="flex h-full min-h-0 flex-col overflow-hidden">
          <RunResultSummary run={run} />
          <div className="mb-3 px-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Assigned to</span>
            <div className="mt-1">
              <AssigneeInput
                value={localAssignedTo}
                onChange={setLocalAssignedTo}
                onBlur={() => flush()}
                suggestions={allUsernames ?? []}
                placeholder="Default for cases in this run"
              />
            </div>
          </div>
          <div className="mb-3 px-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Release
            </span>
            <div className="mt-1">
              <TicketReleaseInput
                value={localRelease}
                onChange={(id) => {
                  setLocalRelease(normalizeReleaseValue(id));
                }}
                onBlur={() => flush()}
                repoSlug={repoSlug}
              />
            </div>
          </div>
          <div className="mb-3 px-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Covers
              </span>
              <button
                type="button"
                onClick={handleAddFromCases}
                disabled={addingFromCases}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-slate-800"
              >
                {addingFromCases ? "Adding…" : "Add from cases in this run"}
              </button>
            </div>
            <div className="mt-1">
              <TicketIdsInput
                value={localRequirementIds}
                onChange={(ids) => {
                  setLocalRequirementIds(normalizeRequirementIds(ids));
                }}
                repoSlug={repoSlug}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <MarkdownToolbar {...toolbarProps} />
            </div>
            <div className="relative px-2 py-2">
              <BodyMarkdownEditor {...descEditorProps} />
            </div>
            {error && (
              <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}
            {commentBlock ? <div className="mt-6 px-2">{commentBlock}</div> : null}
            <div className="mt-6 px-2 pb-4">
              <RunBreakdownStats
                runId={run.run_id}
                repoSlug={repoSlug}
                totalCases={run.total_cases ?? 0}
              />
            </div>
          </div>
        </div>
      </DetailPanel>
    );
  }

  // ─── View mode (description rendered as Markdown in body area) ───
  return (
    <DetailPanel
      title={run.name}
      statusBadge={
        statusBadge ?? (
          <ApproveStatusBadge status={run.approve_status} entityType="run" reviewEnabled={reviewEnabled} />
        )
      }
      subtitle={subtitle}
      headerExtra={
        onToggleEdit && !readOnly ? (
          <Tooltip label="Edit" placement="bottom-end">
            <button
              type="button"
              onClick={() => onToggleEdit?.(true)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </Tooltip>
        ) : null
      }
      footer={footer}
    >
      <RunResultSummary run={run} />

      {run.assigned_to ? (
        <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assigned to </span>
          <span className="font-semibold">{run.assigned_to}</span>
        </p>
      ) : null}

      <RunReleaseView
        releaseId={run.release}
        repoSlug={repoSlug}
        onNavigateToRelease={onNavigateToRelease}
      />

      {viewRequirementIds.length > 0 ? (
        <div className="mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Covers
          </span>
          <TicketIdTitleList
            ticketIds={viewRequirementIds}
            repoSlug={repoSlug}
            onOpenTicket={onOpenTicket}
          />
        </div>
      ) : null}

      {run.description ? (
        <article className="prose-rex mb-3">{renderMarkdown(run.description)}</article>
      ) : (
        <p className="mb-3 text-sm text-slate-400 dark:text-slate-500">No description.</p>
      )}

      {commentBlock ? <div className="mt-6">{commentBlock}</div> : null}

      <div className="mt-6 pb-4">
        <RunBreakdownStats
          runId={run.run_id}
          repoSlug={repoSlug}
          totalCases={run.total_cases ?? 0}
        />
      </div>
    </DetailPanel>
  );
}

export default RunSummaryPanel;
