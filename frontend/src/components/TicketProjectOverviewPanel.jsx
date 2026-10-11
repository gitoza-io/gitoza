import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import BodyMarkdownEditor from "./BodyMarkdownEditor";
import DetailPanel from "./DetailPanel";
import MarkdownToolbar from "./MarkdownToolbar";
import Tooltip from "./Tooltip";
import { renderMarkdown } from "./TestCaseDetailModal";
import {
  MetricCard,
  StatusCountList,
  TypeCountList,
  statusCountRowsFromBreakdown,
  typeCountRowsFromBreakdown,
} from "./overviewMetricCards";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import {
  getTicketProject,
  getTicketProjectBreakdown,
  updateTicketProject,
} from "../services/api";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";
import { ticketProjectDisplayName } from "../utils/sanitize";

/**
 * Ticket project overview when a project is selected and no ticket is open.
 */
function TicketProjectOverviewPanel({
  projectName,
  displayName = null,
  activeRepoSlug = null,
}) {
  const [meta, setMeta] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [description, setDescription] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [measuredBodyHeight, setMeasuredBodyHeight] = useState(null);
  const bodyMeasureRef = useRef(null);
  const isEditingDescriptionRef = useRef(false);
  isEditingDescriptionRef.current = isEditingDescription;

  const displayTitle =
    displayName || ticketProjectDisplayName(projectName) || projectName || "Untitled";
  const prefix = (meta?.ticket_prefix || "").trim();
  const title = prefix ? (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="min-w-0 truncate">{displayTitle}</span>
      <span className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden>
        /
      </span>
      <span className="shrink-0 font-mono text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">
        {prefix}
      </span>
    </span>
  ) : (
    displayTitle
  );

  useEffect(() => {
    setIsEditingDescription(false);
    setMeasuredBodyHeight(null);
  }, [projectName]);

  useEffect(() => {
    if (!projectName || !activeRepoSlug) {
      setMeta(null);
      setBreakdown(null);
      setDescription("");
      setLoading(false);
      setError(null);
      setMetaError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetaError(null);
    Promise.all([
      getTicketProject(projectName, activeRepoSlug),
      getTicketProjectBreakdown(projectName, activeRepoSlug),
    ])
      .then(([projectMeta, stats]) => {
        if (cancelled) return;
        setMeta(projectMeta ?? null);
        if (!isEditingDescriptionRef.current) {
          setDescription(projectMeta?.description ?? "");
        }
        setBreakdown(stats ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setMeta(null);
        setBreakdown(null);
        setDescription("");
        setError("Failed to load project overview.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, activeRepoSlug]);

  useEffect(() => {
    if (!isEditingDescription) {
      setMeasuredBodyHeight(null);
    }
  }, [isEditingDescription]);

  useEffect(() => {
    if (!isEditingDescription || !bodyMeasureRef.current) return;
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
  }, [isEditingDescription, description]);

  const persistedDescription = meta?.description ?? "";

  const handleSaveDescription = useCallback(
    async (draft) => {
      if (!projectName || !activeRepoSlug) return;
      const next = draft?.description ?? "";
      try {
        const updated = await updateTicketProject(
          projectName,
          { description: next },
          activeRepoSlug,
        );
        setMeta(updated ?? { ...(meta || {}), description: next });
        setMetaError(null);
      } catch (e) {
        setMetaError(e?.message || "Failed to save description.");
        throw e;
      }
    },
    [projectName, activeRepoSlug, meta],
  );

  const { saving, flush } = useDebouncedAutoSave({
    enabled: Boolean(
      isEditingDescription && projectName && activeRepoSlug && meta && !meta?.archived,
    ),
    key: projectName || "",
    draft: { description },
    persisted: { description: persistedDescription },
    normalize: (d) => ({ description: d?.description ?? "" }),
    save: handleSaveDescription,
    delayMs: DEBOUNCE_MS,
  });

  useEffect(() => {
    return registerAutoSaveFlush(flush);
  }, [flush]);

  const { toolbarProps, getLiveEditorProps } = useMarkdownEditor(description, setDescription, {
    onBlur: () => flush(),
    growWithContent: true,
    initialHeight: measuredBodyHeight ?? undefined,
    livePreview: true,
    repoSlug: activeRepoSlug,
  });

  const statusRows = useMemo(
    () => statusCountRowsFromBreakdown(breakdown?.by_status),
    [breakdown],
  );

  const typeRows = useMemo(
    () => typeCountRowsFromBreakdown(breakdown?.by_type),
    [breakdown],
  );

  const total = breakdown?.total ?? 0;
  const backlogCount = breakdown?.backlog_count ?? 0;
  const initialLoad = loading && !breakdown && !meta;
  const canEdit = Boolean(meta && !meta.archived);

  const headerExtra = canEdit ? (
    isEditingDescription ? (
      <div className="flex items-center gap-1">
        {saving ? (
          <span className="text-[11px] font-medium text-indigo-700 dark:text-indigo-200">
            Saving…
          </span>
        ) : null}
        <Tooltip label="View" placement="bottom-end">
          <button
            type="button"
            onClick={async () => {
              await Promise.resolve();
              await flush();
              setIsEditingDescription(false);
            }}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="View description"
          >
            <Eye className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
    ) : (
      <Tooltip label="Edit description" placement="bottom-end">
        <button
          type="button"
          onClick={() => setIsEditingDescription(true)}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
          aria-label="Edit description"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </Tooltip>
    )
  ) : null;

  const bodyEditorProps = getLiveEditorProps({
    placeholder: "Add a project description… (Markdown supported)",
    "aria-label": "Project description (Markdown)",
    className:
      "min-h-[7.5rem] w-full overflow-y-hidden resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500",
    measureRef: bodyMeasureRef,
  });

  return (
    <DetailPanel title={title} headerExtra={headerExtra} bodyScroll>
      <div className="space-y-3 pb-4">
        {error ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
        ) : null}
        {metaError ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{metaError}</p>
        ) : null}

        <MetricCard title="Description" titleId="ticket-project-overview-description-heading">
          {initialLoad ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
          ) : isEditingDescription ? (
            <div className="overflow-hidden rounded-sm border border-slate-200 dark:border-slate-600">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <MarkdownToolbar {...toolbarProps} />
              </div>
              <div className="relative px-2.5 py-2">
                <BodyMarkdownEditor {...bodyEditorProps} />
              </div>
            </div>
          ) : description?.trim() ? (
            <article className="prose-rex">
              {renderMarkdown(description, { repoSlug: activeRepoSlug })}
            </article>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">No description.</p>
          )}
        </MetricCard>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MetricCard title="Total tickets" titleId="ticket-project-overview-total-heading">
            {!error && (total > 0 || initialLoad) ? (
              <div className="space-y-2">
                <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {total}
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {backlogCount} in backlog (no release)
                </p>
              </div>
            ) : initialLoad ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                No tickets in this project yet.
              </p>
            )}
          </MetricCard>

          <MetricCard title="Backlog" titleId="ticket-project-overview-backlog-heading">
            {initialLoad ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
            ) : (
              <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {backlogCount}
              </p>
            )}
          </MetricCard>

          <MetricCard title="By status" titleId="ticket-project-overview-status-heading">
            {initialLoad ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
            ) : (
              <StatusCountList rows={statusRows} />
            )}
          </MetricCard>

          <MetricCard title="By type" titleId="ticket-project-overview-type-heading">
            {initialLoad ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
            ) : (
              <TypeCountList rows={typeRows} />
            )}
          </MetricCard>
        </div>
      </div>
    </DetailPanel>
  );
}

export default TicketProjectOverviewPanel;
