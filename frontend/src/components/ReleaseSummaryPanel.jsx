import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Eye, Pencil } from "lucide-react";
import { renderMarkdown } from "./TestCaseDetailModal";
import UpdatedByLine from "./UpdatedByLine";
import {
  METADATA_EDIT_INPUT_CLS,
  METADATA_EDIT_INPUT_DEFAULT_CLS,
  MetadataFieldEdit,
  MetadataFieldRead,
} from "./MetadataField";
import DetailPanel from "./DetailPanel";
import Tooltip from "./Tooltip";
import MarkdownToolbar from "./MarkdownToolbar";
import BodyMarkdownEditor from "./BodyMarkdownEditor";
import {
  MetricCard,
  RELEASE_LIFECYCLE_STATUS_VISUAL,
  StatusCountList,
  TicketStatusProgressBar,
  TypeCountList,
  statusCountRowsFromBreakdown,
  typeCountRowsFromBreakdown,
} from "./overviewMetricCards";
import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";
import { getReleaseTicketBreakdown, updateRelease } from "../services/api";
import ReleaseLinkedRuns from "./ReleaseLinkedRuns";

const inlineCls =
  "border-0 bg-transparent p-0 shadow-none focus:ring-0 focus:outline-none";

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function normalizeReleaseDraft(d) {
  const name = (d.name || "").trim();
  // Empty name must not wipe YAML — treat as unchanged vs persisted by callers.
  return {
    name,
    status: (d.status || "open").trim().toLowerCase() || "open",
    body: d.body || "",
  };
}

/**
 * Release header summary / edit panel (column 3 when no ticket selected).
 * Project is path-derived and read-only. Edit uses debounced autosave like tickets/runs.
 */
export default function ReleaseSummaryPanel({
  releaseDetail = null,
  loading = false,
  repoSlug = null,
  isEditing = false,
  onToggleEdit = null,
  onSaved = null,
  onNavigateToRun = null,
  onAfterRepoWrite = null,
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("open");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [copiedReleaseId, setCopiedReleaseId] = useState(false);
  const [measuredBodyHeight, setMeasuredBodyHeight] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState(null);
  const bodyMeasureRef = useRef(null);
  const draftRef = useRef({ name: "", status: "open", body: "" });
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (!releaseDetail) return;
    // Do not clobber the in-progress draft when autosave updates releaseDetail.
    if (isEditing) return;
    setName(releaseDetail.name ?? "");
    setStatus((releaseDetail.status || "open").toLowerCase());
    setBody(releaseDetail.body ?? "");
    setError("");
    setMeasuredBodyHeight(null);
  }, [
    isEditing,
    releaseDetail?.file_path,
    releaseDetail?.updated_at,
    releaseDetail?.name,
    releaseDetail?.status,
    releaseDetail?.body,
  ]);

  useEffect(() => {
    if (!isEditing) {
      setMeasuredBodyHeight(null);
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing || !bodyMeasureRef.current) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled && bodyMeasureRef.current) {
          setMeasuredBodyHeight(bodyMeasureRef.current.scrollHeight);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [isEditing, body]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const releaseId = releaseDetail?.release_id || null;

  useEffect(() => {
    if (isEditing || !releaseId || !repoSlug) {
      setBreakdown(null);
      setBreakdownLoading(false);
      setBreakdownError(null);
      return undefined;
    }
    let cancelled = false;
    setBreakdownLoading(true);
    setBreakdownError(null);
    getReleaseTicketBreakdown(releaseId, repoSlug)
      .then((data) => {
        if (!cancelled) setBreakdown(data ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setBreakdown(null);
          setBreakdownError("Failed to load ticket breakdown.");
        }
      })
      .finally(() => {
        if (!cancelled) setBreakdownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, releaseId, repoSlug]);

  const draft = { name, status, body };
  draftRef.current = draft;
  const persisted = {
    name: releaseDetail?.name ?? "",
    status: (releaseDetail?.status || "open").toLowerCase(),
    body: releaseDetail?.body ?? "",
  };

  const handleAutoSave = useCallback(
    async (d) => {
      if (!releaseDetail?.file_path || !repoSlug) return;
      const trimmed = (d.name || "").trim();
      if (!trimmed) {
        setError("Name is required");
        return;
      }
      setError("");
      try {
        const updated = await updateRelease(
          releaseDetail.file_path,
          {
            name: trimmed,
            status: (d.status || "open").trim().toLowerCase() || "open",
            body: d.body || "",
          },
          repoSlug,
        );
        onSaved?.(updated);
      } catch (e) {
        setError(e?.message || "Failed to save");
        throw e;
      }
    },
    [releaseDetail?.file_path, repoSlug, onSaved],
  );

  const normalizeForSave = useCallback(
    (d) => {
      const norm = normalizeReleaseDraft(d);
      if (!norm.name) {
        // Skip write: compare equal to persisted so empty name never persists.
        return normalizeReleaseDraft({
          name: releaseDetail?.name ?? "",
          status: (releaseDetail?.status || "open").toLowerCase(),
          body: releaseDetail?.body ?? "",
        });
      }
      return norm;
    },
    [releaseDetail?.name, releaseDetail?.status, releaseDetail?.body],
  );

  const { flush, saving } = useDebouncedAutoSave({
    enabled: isEditing && !!releaseDetail?.file_path && !!repoSlug,
    key: releaseDetail?.file_path,
    draft,
    persisted,
    normalize: normalizeForSave,
    save: handleAutoSave,
    delayMs: DEBOUNCE_MS,
  });

  useEffect(() => {
    return registerAutoSaveFlush(flush);
  }, [flush]);

  useEffect(() => {
    if (!isEditing) return;
    const trimmed = (name || "").trim();
    if (!trimmed) {
      setError("Name is required");
    } else {
      setError((prev) => (prev === "Name is required" ? "" : prev));
    }
  }, [name, isEditing]);

  const onCopyReleaseId = useCallback(async () => {
    const id = releaseDetail?.release_id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedReleaseId(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedReleaseId(false), 1500);
    } catch {
      /* ignore */
    }
  }, [releaseDetail?.release_id]);

  const { toolbarProps, getLiveEditorProps } = useMarkdownEditor(body, setBody, {
    onBlur: () => flush(),
    growWithContent: true,
    initialHeight: measuredBodyHeight ?? undefined,
    livePreview: true,
    repoSlug,
  });

  const statusRows = useMemo(
    () => statusCountRowsFromBreakdown(breakdown?.by_status),
    [breakdown],
  );
  const typeRows = useMemo(
    () => typeCountRowsFromBreakdown(breakdown?.by_type),
    [breakdown],
  );
  const lifecycleKey = String(releaseDetail?.status || "open").trim().toLowerCase();
  const lifecycleClass =
    RELEASE_LIFECYCLE_STATUS_VISUAL[lifecycleKey] || RELEASE_LIFECYCLE_STATUS_VISUAL.open;

  if (loading && !releaseDetail) {
    return (
      <DetailPanel title="Release">
        <p className="p-4 text-sm text-slate-600 dark:text-slate-300">Loading…</p>
      </DetailPanel>
    );
  }

  if (!releaseDetail) {
    return (
      <DetailPanel title="Release">
        <p className="p-4 text-center text-sm text-slate-600 dark:text-slate-300">Select a release</p>
      </DetailPanel>
    );
  }

  const projectTitle = releaseDetail.project || "Release";

  const copyReleaseIdButton = (
    <Tooltip label={copiedReleaseId ? "Copied" : "Copy ID"} placement="bottom">
      <button
        type="button"
        onClick={onCopyReleaseId}
        disabled={!releaseDetail.release_id}
        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
        aria-label={copiedReleaseId ? "Copied" : "Copy release ID"}
      >
        {copiedReleaseId ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <ClipboardCopy className="h-4 w-4" aria-hidden />
        )}
      </button>
    </Tooltip>
  );

  if (isEditing) {
    const bodyEditorProps = getLiveEditorProps({
      placeholder: "Short release description… (Markdown supported)",
      "aria-label": "Release body (Markdown)",
      className:
        "min-h-[7.5rem] w-full overflow-y-hidden resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500",
      measureRef: bodyMeasureRef,
    });

    return (
      <DetailPanel
        title={<span className="text-sm text-slate-700 dark:text-slate-300">{projectTitle}</span>}
        bodyScroll={false}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="relative z-20 shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Untitled release"
                className={`${inlineCls} min-w-0 flex-1 rounded border border-indigo-200 bg-white text-lg font-bold leading-snug text-slate-900 outline-none ring-indigo-400 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 dark:border-indigo-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600`}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <div className="flex items-center gap-0.5">
                <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
                  {releaseDetail.release_id || "—"}
                </span>
                {copyReleaseIdButton}
              </div>
              <Tooltip label="Editing mode" placement="bottom">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-100">
                  <Pencil className="h-3 w-3" />
                  Editing{saving ? "…" : ""}
                </span>
              </Tooltip>
              <Tooltip label="View" placement="bottom-end">
                <button
                  type="button"
                  onClick={async () => {
                    await Promise.resolve();
                    await flush();
                    const d = draftRef.current;
                    onToggleEdit?.(false, {
                      name: d.name,
                      status: d.status,
                      body: d.body,
                    });
                  }}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  aria-label="View"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            {error ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-wrap items-stretch gap-2 px-3 pb-2 pt-3">
              <MetadataFieldRead label="Project" value={releaseDetail.project || "—"} />
              <MetadataFieldEdit label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={`${METADATA_EDIT_INPUT_CLS} ${METADATA_EDIT_INPUT_DEFAULT_CLS} cursor-pointer appearance-none pr-7 shadow-sm`}
                >
                  <option value="open">Open</option>
                  <option value="shipped">Shipped</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </MetadataFieldEdit>
            </div>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <MarkdownToolbar {...toolbarProps} />
            </div>
            <div className="relative px-3 py-2">
              <BodyMarkdownEditor {...bodyEditorProps} />
            </div>
            <div className="px-3 pb-4">
              <ReleaseLinkedRuns
                releaseId={releaseId}
                repoSlug={repoSlug}
                editable={true}
                onNavigateToRun={onNavigateToRun}
                onAfterChange={onAfterRepoWrite}
              />
            </div>
          </div>

          {releaseDetail.updated_at || releaseDetail.updated_by ? (
            <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
              <UpdatedByLine
                updatedAt={releaseDetail.updated_at}
                updatedBy={releaseDetail.updated_by}
              />
            </footer>
          ) : null}
        </div>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel
      title={<span className="text-sm text-slate-700 dark:text-slate-300">{projectTitle}</span>}
      bodyScroll={false}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200 px-3 py-3 dark:border-slate-700">
          <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">
            {releaseDetail.name || releaseDetail.release_id || "Untitled release"}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div className="flex items-center gap-0.5">
              <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
                {releaseDetail.release_id || "—"}
              </span>
              {copyReleaseIdButton}
              {onToggleEdit ? (
                <Tooltip label="Edit" placement="bottom-end">
                  <button
                    type="button"
                    onClick={() => onToggleEdit(true)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                    aria-label="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <div className="flex flex-wrap gap-2">
            {releaseDetail.project ? (
              <MetadataFieldRead label="Project" value={releaseDetail.project} />
            ) : null}
            {releaseDetail.status ? (
              <MetadataFieldRead
                label="Status"
                value={capitalize(releaseDetail.status)}
                valueClassName={`font-medium ${lifecycleClass}`}
              />
            ) : null}
          </div>
          {releaseDetail.body ? (
            <article className="prose-rex">{renderMarkdown(releaseDetail.body, { repoSlug })}</article>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">No description.</p>
          )}

          {breakdownError ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{breakdownError}</p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <MetricCard title="By status" titleId="release-overview-status-heading">
              {breakdownLoading && !breakdown ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <div className="space-y-3">
                  <TicketStatusProgressBar byStatus={breakdown?.by_status} />
                  <StatusCountList rows={statusRows} />
                </div>
              )}
            </MetricCard>

            <MetricCard title="By type" titleId="release-overview-type-heading">
              {breakdownLoading && !breakdown ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <TypeCountList rows={typeRows} />
              )}
            </MetricCard>
          </div>

          <ReleaseLinkedRuns
            releaseId={releaseId}
            repoSlug={repoSlug}
            editable={false}
            onNavigateToRun={onNavigateToRun}
            onAfterChange={onAfterRepoWrite}
          />
        </div>
        {releaseDetail.updated_at || releaseDetail.updated_by ? (
          <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
            <UpdatedByLine
              updatedAt={releaseDetail.updated_at}
              updatedBy={releaseDetail.updated_by}
            />
          </footer>
        ) : null}
      </div>
    </DetailPanel>
  );
}
