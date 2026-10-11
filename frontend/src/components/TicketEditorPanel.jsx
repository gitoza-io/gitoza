import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Eye, Pencil, Ticket } from "lucide-react";
import CommentStream from "./CommentStream";
import DetailPanel from "./DetailPanel";
import DetailPanelEmpty from "./DetailPanelEmpty";
import BodyMarkdownEditor from "./BodyMarkdownEditor";
import MarkdownToolbar from "./MarkdownToolbar";
import StickyThenScroll from "./StickyThenScroll";
import TicketDetailView from "./TicketDetailView";
import { CustomFieldsEditStrip } from "./CaseCustomFields";
import { ChildTickets, LinkedCases, LinkedRuns } from "./TicketRelatedLists";
import Tooltip from "./Tooltip";
import UpdatedByLine from "./UpdatedByLine";
import AssigneeInput from "./AssigneeInput";
import TagsInput from "./TagsInput";
import TicketParentInput from "./TicketParentInput";
import TicketReleaseInput from "./TicketReleaseInput";
import EntityLinkPicker from "./EntityLinkPicker";
import {
  METADATA_EDIT_INPUT_CLS,
  METADATA_EDIT_INPUT_DEFAULT_CLS,
  MetadataFieldEdit,
} from "./MetadataField";
import { priorityColors } from "./TestCaseDetailModal";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { useGitUserName } from "../hooks/useGitUserName";
import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { ticketProjectFromPath } from "../constants/ticketPaths";
import { TICKET_STATUS_OPTIONS } from "../utils/ticketStatus";
import { isTauri } from "../utils/tauriEnv";
import { saveTestAsset } from "../services/api";
import { copyToClipboard } from "../utils/copyToClipboard.js";
import { generateAssetFileName } from "../utils/generateAssetFileName";
import { markdownImageSnippet } from "../utils/markdownImageSnippet";
import { formatWikiPageLink, formatWikiTicketLink } from "../utils/ticketLinks";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";

const inlineCls =
  "bg-transparent border-0 border-b border-transparent outline-none transition-colors focus:border-indigo-400 dark:focus:border-indigo-500";

const normalizeParamsRecord = (params) => {
  const entries = Object.entries(params ?? {})
    .map(([k, v]) => [String(k).trim(), String(v).trim()])
    .filter(([k, v]) => k && v)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
};

const normalizeTicketDraft = (d) => ({
  title: (d.title || "").trim(),
  type: (d.type || "task").trim().toLowerCase(),
  status: (d.status || "open").trim().toLowerCase(),
  priority: (d.priority || "medium").trim().toLowerCase(),
  tags: (d.tagsStr || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(","),
  assigned_to: (d.assignedTo || "").trim(),
  sprint: (d.sprint || "").trim(),
  release: (d.release || "").trim(),
  parent: (d.parent || "").trim(),
  body: (d.body || "").trim(),
  params: normalizeParamsRecord(d.params),
});

/**
 * Ticket detail / edit panel — mirrors CaseEditorPanel (autosave + LiveMarkdownEditor).
 * New tickets are created instantly from the Tickets page (auto id); no create form here.
 */
function TicketEditorPanel({
  ticketDetail = null,
  selectedTicketFilePath = null,
  ticketDetailLoading = false,
  /** Bumped only after a successful detail GET so the form re-hydrates; autosave must not bump. */
  ticketDetailLoadGeneration = 0,
  isEditing = false,
  autoFocusTitlePath = null,
  onTitleFocused = null,
  onToggleEdit,
  onSave,
  onPostComment,
  onDeleteComment,
  onStartCreate,
  allTags = null,
  paramKeys = null,
  paramValuesByKey = null,
  allUsernames = null,
  repoSlug = null,
  gitProfileVersion = 0,
  onOpenTicket = null,
  onNavigateToCase = null,
  onNavigateToRun = null,
  onNavigateToRelease = null,
  onOpenWikiPage = null,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
}) {
  const [ticketId, setTicketId] = useState("");
  const [title, setTitle] = useState("");
  const [ticketType, setTicketType] = useState("task");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("medium");
  const [tagsStr, setTagsStr] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [sprint, setSprint] = useState("");
  const [release, setRelease] = useState("");
  const [parent, setParent] = useState("");
  const [params, setParams] = useState({});
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);
  const [formSyncedPath, setFormSyncedPath] = useState(null);
  const [measuredBodyHeight, setMeasuredBodyHeight] = useState(null);
  const prevInitKeyRef = useRef(null);
  const bodyMeasureRef = useRef(null);
  const titleInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const linkButtonRef = useRef(null);
  const pendingLinkSelectionRef = useRef(null);
  const [entityLinkPickerOpen, setEntityLinkPickerOpen] = useState(false);
  const [copiedTicketId, setCopiedTicketId] = useState(false);
  const gitUserName = useGitUserName(repoSlug, gitProfileVersion);

  const ticketDetailReady =
    !ticketDetailLoading &&
    !!ticketDetail &&
    !!selectedTicketFilePath &&
    ticketDetail.file_path === selectedTicketFilePath &&
    formSyncedPath === selectedTicketFilePath &&
    formSyncedPath === ticketDetail.file_path;

  useEffect(() => {
    if (!ticketDetail) {
      setFormSyncedPath(null);
      prevInitKeyRef.current = null;
      return;
    }
    if (ticketDetail.file_path !== selectedTicketFilePath) {
      setFormSyncedPath(null);
      prevInitKeyRef.current = null;
      return;
    }
    const initKey = `${selectedTicketFilePath}::${ticketDetailLoadGeneration}`;
    if (initKey === prevInitKeyRef.current) return;
    prevInitKeyRef.current = initKey;
    setTicketId(ticketDetail.ticket_id ?? "");
    setTitle(ticketDetail.title ?? "");
    setTicketType((ticketDetail.type || ticketDetail.ticket_type || "task").toLowerCase());
    setStatus((ticketDetail.status ?? "open").toLowerCase());
    setPriority((ticketDetail.priority ?? "medium").toLowerCase());
    setTagsStr(Array.isArray(ticketDetail.tags) ? ticketDetail.tags.join(", ") : "");
    setAssignedTo(ticketDetail.assigned_to ?? "");
    setSprint(ticketDetail.sprint ?? "");
    setRelease(ticketDetail.release ?? "");
    setParent(ticketDetail.parent ?? "");
    setParams(ticketDetail.params ?? {});
    setBody(ticketDetail.body ?? "");
    setError("");
    setCopiedTicketId(false);
    setFormSyncedPath(selectedTicketFilePath);
  }, [ticketDetail, selectedTicketFilePath, ticketDetailLoadGeneration]);

  const onCopyTicketId = useCallback(async () => {
    const id = (ticketDetail?.ticket_id || ticketId || "").trim();
    if (!id) return;
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedTicketId(true);
      window.setTimeout(() => setCopiedTicketId(false), 2000);
    }
  }, [ticketDetail?.ticket_id, ticketId]);

  useEffect(() => {
    if (!isEditing) {
      prevInitKeyRef.current = null;
      setMeasuredBodyHeight(null);
    }
  }, [isEditing]);

  // After create: focus title and select placeholder once form is ready.
  useEffect(() => {
    if (
      !isEditing ||
      !autoFocusTitlePath ||
      !ticketDetailReady ||
      selectedTicketFilePath !== autoFocusTitlePath
    ) {
      return undefined;
    }
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el = titleInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
        onTitleFocused?.();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [
    isEditing,
    autoFocusTitlePath,
    ticketDetailReady,
    selectedTicketFilePath,
    onTitleFocused,
  ]);

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

  const draft = useMemo(
    () => ({
      title,
      type: ticketType,
      status,
      priority,
      tagsStr,
      assignedTo,
      sprint,
      release,
      parent,
      body,
      params,
    }),
    [
      title,
      ticketType,
      status,
      priority,
      tagsStr,
      assignedTo,
      sprint,
      release,
      parent,
      body,
      params,
    ],
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const persistedSnapshot = useMemo(
    () => ({
      title: ticketDetail?.title ?? "",
      type: (ticketDetail?.type || ticketDetail?.ticket_type || "task").toLowerCase(),
      status: (ticketDetail?.status ?? "open").toLowerCase(),
      priority: (ticketDetail?.priority ?? "medium").toLowerCase(),
      tagsStr: Array.isArray(ticketDetail?.tags) ? ticketDetail.tags.join(", ") : "",
      assignedTo: ticketDetail?.assigned_to ?? "",
      sprint: ticketDetail?.sprint ?? "",
      release: ticketDetail?.release ?? "",
      parent: ticketDetail?.parent ?? "",
      body: ticketDetail?.body ?? "",
      params: ticketDetail?.params ?? {},
    }),
    [ticketDetail],
  );

  const displayTags = useMemo(
    () =>
      (tagsStr || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsStr],
  );

  const persistedTags = useMemo(() => {
    if (Array.isArray(allTags) && allTags.length > 0) {
      return Array.from(new Set(allTags.map((t) => String(t).trim()).filter(Boolean)));
    }
    return (persistedSnapshot.tagsStr || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [allTags, persistedSnapshot.tagsStr]);

  const handleTagsChange = useCallback((tags) => {
    setTagsStr((Array.isArray(tags) ? tags : []).join(", "));
  }, []);

  const handleAutoSave = useCallback(
    async (d) => {
      // Use the ticket path closed over with this save fn (snapshot on key change /
      // unmount), not the currently selected path — otherwise switching tickets
      // before debounce fires silently drops metadata edits (e.g. release).
      const targetPath = ticketDetail?.file_path;
      if (!targetPath || !onSave) return;
      setError("");
      const tags = (d.tagsStr || "").split(",").map((t) => t.trim()).filter(Boolean);
      try {
        await onSave({
          file_path: targetPath,
          title: d.title.trim(),
          type: d.type,
          status: d.status,
          priority: d.priority,
          tags,
          assigned_to: (d.assignedTo || "").trim(),
          sprint: (d.sprint || "").trim(),
          release: (d.release || "").trim(),
          parent: (d.parent || "").trim(),
          body: (d.body || "").trim(),
          params: d.params ?? {},
        });
      } catch (err) {
        setError(err?.message || "Auto-save failed");
      }
    },
    [onSave, ticketDetail?.file_path],
  );

  const { flush, saving } = useDebouncedAutoSave({
    enabled: isEditing && !!selectedTicketFilePath && ticketDetailReady,
    key: selectedTicketFilePath,
    draft,
    persisted: persistedSnapshot,
    normalize: normalizeTicketDraft,
    save: handleAutoSave,
    delayMs: DEBOUNCE_MS,
    silent: true,
  });

  useEffect(() => registerAutoSaveFlush(flush), [flush]);

  const { getLiveEditorProps, toolbarProps, insertAtCursor, liveEditorRef } = useMarkdownEditor(
    body,
    setBody,
    {
      onBlur: flush,
      disabled: false,
      growWithContent: true,
      initialHeight: measuredBodyHeight ?? undefined,
      livePreview: true,
      repoSlug,
    },
  );

  const processImageFile = useCallback(
    async (file) => {
      if (!repoSlug || !file?.type?.startsWith("image/")) {
        setError("Only image files can be attached.");
        return;
      }
      setError("");
      try {
        const name = generateAssetFileName(file.type);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await saveTestAsset(repoSlug, name, Array.from(bytes));
        insertAtCursor(markdownImageSnippet(name));
      } catch (err) {
        setError(err?.message || String(err) || "Failed to save image");
      }
    },
    [repoSlug, insertAtCursor],
  );

  const handleImageInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) processImageFile(file);
      e.target.value = "";
    },
    [processImageFile],
  );

  const imageBlockedBySync = isTauri() && Boolean(repoSlug) && !storageSyncConfigured;

  const handleInsertImageClick = useCallback(() => {
    if (!isTauri()) {
      setError("Image insert is available in the desktop app only.");
      return;
    }
    if (!repoSlug) {
      setError("Connect a workspace repository to attach images.");
      return;
    }
    if (imageBlockedBySync) {
      onOpenStorageSyncSettings?.();
      return;
    }
    imageInputRef.current?.click();
  }, [repoSlug, imageBlockedBySync, onOpenStorageSyncSettings]);

  const handleInsertEntityLinkClick = useCallback(() => {
    if (!repoSlug) return;
    const ed = liveEditorRef.current;
    const el = ed?.getTextareaRef?.() ?? null;
    if (el && typeof el.selectionStart === "number" && typeof el.selectionEnd === "number") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = (el.value || "").slice(start, end).trim();
      pendingLinkSelectionRef.current =
        end > start
          ? { label: selected, start, end }
          : { label: "", start, end: start };
    } else if (typeof ed?.getSelectedText === "function") {
      const selected = (ed.getSelectedText() || "").trim();
      pendingLinkSelectionRef.current = { label: selected, start: 0, end: 0 };
    } else {
      pendingLinkSelectionRef.current = null;
    }
    setEntityLinkPickerOpen((open) => !open);
  }, [repoSlug, liveEditorRef]);

  const applyLinkSnippet = useCallback(
    (snippet) => {
      if (!snippet) return;
      const pending = pendingLinkSelectionRef.current;
      const el = liveEditorRef.current?.getTextareaRef?.() ?? null;
      if (el && pending && typeof pending.start === "number" && pending.end > pending.start) {
        el.focus();
        el.setSelectionRange(pending.start, pending.end);
      }
      insertAtCursor(`${snippet} `);
      pendingLinkSelectionRef.current = null;
    },
    [insertAtCursor, liveEditorRef],
  );

  const handleEntityLinkSelect = useCallback(
    (item) => {
      const id = (item?.id || "").trim();
      if (!id || !item?.kind) return;
      const pending = pendingLinkSelectionRef.current;
      const selectedLabel = (pending?.label || "").trim();
      const title = (item?.title || "").trim();
      const snippet =
        item.kind === "wiki"
          ? formatWikiPageLink(id, selectedLabel || title)
          : formatWikiTicketLink(id, selectedLabel || title);
      applyLinkSnippet(snippet);
      setEntityLinkPickerOpen(false);
    },
    [applyLinkSnippet],
  );

  const commentStream = ticketDetail ? (
    <CommentStream
      comments={ticketDetail.comments ?? []}
      currentAuthor={gitUserName}
      posting={commentPosting}
      onPost={
        onPostComment 
          ? async (text) => {
              setCommentPosting(true);
              try {
                await onPostComment(ticketDetail.file_path, text);
              } finally {
                setCommentPosting(false);
              }
            }
          : undefined
      }
      onDelete={
        onDeleteComment 
          ? async (index) => onDeleteComment(ticketDetail.file_path, index)
          : undefined
      }
    />
  ) : null;

  if (selectedTicketFilePath && ticketDetailLoading && !ticketDetail) {
    return (
      <DetailPanel>
        <div className="flex min-h-[12rem] flex-1 items-center justify-center px-4 text-sm text-slate-500 dark:text-slate-400">
          Loading ticket…
        </div>
      </DetailPanel>
    );
  }

  if (!ticketDetail) {
    return (
      <DetailPanel>
        <DetailPanelEmpty
          iconComponent={Ticket}
          title="Select a ticket from the list"
          description="or create a new one"
          action={
            onStartCreate ? (
              <button
                type="button"
                onClick={onStartCreate}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                New ticket
              </button>
            ) : undefined
          }
        />
      </DetailPanel>
    );
  }

  const projectTitle =
    ticketProjectFromPath(ticketDetail?.file_path ?? selectedTicketFilePath) ?? "Project";
  const ticketProject =
    ticketProjectFromPath(ticketDetail?.file_path ?? selectedTicketFilePath) || null;

  const copyTicketIdButton = (
    <Tooltip label={copiedTicketId ? "Copied" : "Copy ID"} placement="bottom">
      <button
        type="button"
        onClick={onCopyTicketId}
        disabled={!(ticketDetail?.ticket_id || ticketId)}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
        aria-label={copiedTicketId ? "Copied" : "Copy ticket ID"}
      >
        {copiedTicketId ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <ClipboardCopy className="h-4 w-4" aria-hidden />
        )}
      </button>
    </Tooltip>
  );

  if (!isEditing && ticketDetail) {
    return (
      <DetailPanel
        title={<span className="text-sm text-slate-600 dark:text-slate-300">{projectTitle}</span>}
        bodyScroll={false}
      >
        <TicketDetailView
          ticket={{ ...ticketDetail, body: body ?? ticketDetail.body }}
          repoSlug={repoSlug}
          onOpenTicket={onOpenTicket}
          onNavigateToCase={onNavigateToCase}
          onNavigateToRun={onNavigateToRun}
          onNavigateToRelease={onNavigateToRelease}
          onOpenWikiPage={onOpenWikiPage}
          scrollEndContent={commentStream}
          ticketIdRowExtra={
            <>
              {copyTicketIdButton}
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
            </>
          }
        />
      </DetailPanel>
    );
  }

  // Edit mode
  const priorityKey = priority.toLowerCase();
  const bodyEditorProps = getLiveEditorProps({
    placeholder: "Write ticket details in Markdown…",
    "aria-label": "Ticket body (Markdown)",
    className:
      "min-h-[7.5rem] w-full overflow-y-hidden resize-none border-0 bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",
    measureRef: bodyMeasureRef,
  });

  const ticketHeader = (
    <header className="relative z-20 border-b border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled ticket"
          className={`${inlineCls} min-w-0 flex-1 rounded border border-indigo-200 bg-white text-lg font-bold leading-snug text-slate-900 outline-none ring-indigo-400 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 dark:border-indigo-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600`}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-0.5">
          <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
            {ticketId || "—"}
          </span>
          {copyTicketIdButton}
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
              // Blur on Eye commits buffered release/parent clears first; yield so
              // React applies setState, then flush autosave before leaving edit.
              await Promise.resolve();
              await flush();
              const d = draftRef.current;
              const viewDraft = {
                title: d.title,
                type: d.type,
                status: d.status,
                priority: d.priority,
                assigned_to: d.assignedTo,
                sprint: d.sprint,
                release: d.release,
                parent: d.parent,
                tagsStr: d.tagsStr,
                body: d.body,
                params: d.params ?? {},
                tags: (d.tagsStr || "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              };
              onToggleEdit?.(false, viewDraft);
            }}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
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
  );

  const ticketMetadataStrip = (
    <div className="flex flex-wrap items-stretch gap-2">
      <MetadataFieldEdit label="Type">
        <select
          value={ticketType}
          onChange={(e) => setTicketType(e.target.value)}
          className={`${METADATA_EDIT_INPUT_CLS} ${METADATA_EDIT_INPUT_DEFAULT_CLS} cursor-pointer appearance-none pr-7 shadow-sm`}
        >
          <option value="bug">Bug</option>
          <option value="story">Story</option>
          <option value="task">Task</option>
          <option value="spike">Spike</option>
        </select>
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${METADATA_EDIT_INPUT_CLS} ${METADATA_EDIT_INPUT_DEFAULT_CLS} cursor-pointer appearance-none pr-7 shadow-sm`}
        >
          {TICKET_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Priority">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={`${METADATA_EDIT_INPUT_CLS} ${priorityColors[priorityKey] || METADATA_EDIT_INPUT_DEFAULT_CLS} cursor-pointer appearance-none pr-7 shadow-sm`}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Assigned to">
        <AssigneeInput
          value={assignedTo}
          onChange={setAssignedTo}
          suggestions={allUsernames ?? []}
          placeholder="—"
        />
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Sprint">
        <input
          type="text"
          value={sprint}
          onChange={(e) => setSprint(e.target.value)}
          placeholder="—"
          className={METADATA_EDIT_INPUT_CLS}
        />
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Release" className="min-w-[9rem]">
        <TicketReleaseInput
          value={release}
          onChange={setRelease}
          onBlur={() => {
            void flush();
          }}
          repoSlug={repoSlug}
          project={ticketProject}
        />
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Parent" className="min-w-[9rem]">
        <TicketParentInput
          value={parent}
          onChange={setParent}
          repoSlug={repoSlug}
          excludeTicketId={ticketId}
        />
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Tags" className="min-w-[12rem]">
        <TagsInput value={displayTags} onChange={handleTagsChange} options={persistedTags} />
      </MetadataFieldEdit>
      <CustomFieldsEditStrip
        value={params}
        onChange={setParams}
        paramKeys={paramKeys ?? []}
        paramValuesByKey={paramValuesByKey ?? {}}
      />
    </div>
  );

  return (
    <DetailPanel
      title={<span className="text-sm text-slate-600 dark:text-slate-300">{projectTitle}</span>}
      bodyScroll={false}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <StickyThenScroll
          stickyContent={ticketHeader}
          scrollContent={
            <>
              <div className="px-3 pb-2 pt-3">{ticketMetadataStrip}</div>
              <div className="sticky top-0 z-20 border-t border-slate-200 bg-white px-3 pt-2 shadow-[0_-2px_0_0_#fff] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_-2px_0_0_#0f172a]">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-hidden
                  tabIndex={-1}
                  onChange={handleImageInputChange}
                />
                <MarkdownToolbar
                  {...toolbarProps}
                  onInsertImage={handleInsertImageClick}
                  imageDisabled={!repoSlug || !isTauri()}
                  imageSyncBlocked={imageBlockedBySync}
                  imageTooltip="Configure storage sync in Project Settings to add images."
                  onImageConfigureClick={onOpenStorageSyncSettings}
                  onInsertEntityLink={handleInsertEntityLinkClick}
                  entityLinkDisabled={!repoSlug}
                  entityLinkActive={entityLinkPickerOpen}
                  entityLinkButtonRef={linkButtonRef}
                />
                <EntityLinkPicker
                  open={entityLinkPickerOpen}
                  anchorRef={linkButtonRef}
                  onClose={() => setEntityLinkPickerOpen(false)}
                  repoSlug={repoSlug}
                  excludeTicketId={ticketId}
                  onSelect={handleEntityLinkSelect}
                />
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="relative">
                  <BodyMarkdownEditor {...bodyEditorProps} />
                </div>
                <ChildTickets ticketId={ticketId} repoSlug={repoSlug} onOpenTicket={onOpenTicket} />
                <LinkedCases
                  ticketId={ticketId}
                  repoSlug={repoSlug}
                  onNavigateToCase={onNavigateToCase}
                  editable
                />
                <LinkedRuns
                  ticketId={ticketId}
                  repoSlug={repoSlug}
                  onNavigateToRun={onNavigateToRun}
                  editable
                />
                {commentStream ? <div className="mt-6">{commentStream}</div> : null}
              </div>
            </>
          }
        />
        {(error || ticketDetail?.updated_at || ticketDetail?.updated_by) && (
          <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
            {error ? (
              <div className="mb-1 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            ) : null}
            <UpdatedByLine
              updatedAt={ticketDetail?.updated_at}
              updatedBy={ticketDetail?.updated_by}
            />
          </footer>
        )}
      </div>
    </DetailPanel>
  );
}

export default TicketEditorPanel;
