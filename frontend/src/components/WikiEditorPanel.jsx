import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Eye, Pencil } from "lucide-react";
import DetailPanel from "./DetailPanel";
import DetailPanelEmpty from "./DetailPanelEmpty";
import BodyMarkdownEditor from "./BodyMarkdownEditor";
import MarkdownToolbar from "./MarkdownToolbar";
import StickyThenScroll from "./StickyThenScroll";
import EntityLinkPicker from "./EntityLinkPicker";
import Tooltip from "./Tooltip";
import UpdatedByLine from "./UpdatedByLine";
import WikiDetailView from "./WikiDetailView";
import { WikiPageIcon } from "./TestEntityIcons";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { isTauri } from "../utils/tauriEnv";
import { saveTestAsset } from "../services/api";
import { copyToClipboard } from "../utils/copyToClipboard.js";
import { generateAssetFileName } from "../utils/generateAssetFileName";
import { markdownImageSnippet } from "../utils/markdownImageSnippet";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";
import { formatWikiPageLink, formatWikiTicketLink } from "../utils/ticketLinks";
import { wikiFolderFromPath, wikiPageIdFromPath } from "../constants/wikiPaths";
import {
  METADATA_EDIT_INPUT_CLS,
  METADATA_EDIT_INPUT_DEFAULT_CLS,
  MetadataFieldEdit,
} from "./MetadataField";
import TagsInput from "./TagsInput";
import { WIKI_STATUS_OPTIONS } from "../utils/wikiStatus";

const inlineCls =
  "bg-transparent border-0 border-b border-transparent outline-none transition-colors focus:border-indigo-400 dark:focus:border-indigo-500";

const normalizeWikiDraft = (d) => ({
  title: (d.title || "").trim(),
  body: (d.body || "").trim(),
  tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim()).filter(Boolean) : [],
  status: String(d.status ?? "draft").trim(),
});

/**
 * Wiki detail / edit panel — title and markdown body with autosave.
 */
function WikiEditorPanel({
  pageDetail = null,
  selectedPageFilePath = null,
  pageDetailLoading = false,
  pageDetailLoadGeneration = 0,
  isEditing = false,
  onToggleEdit,
  readOnly = false,
  onSave,
  onStartCreate,
  allTags = [],
  repoSlug = null,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
  onOpenTicket = null,
  onOpenWikiPage = null,
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [status, setStatus] = useState("draft");
  const [error, setError] = useState("");
  const [formSyncedPath, setFormSyncedPath] = useState(null);
  const [measuredBodyHeight, setMeasuredBodyHeight] = useState(null);
  const [copiedPageId, setCopiedPageId] = useState(false);
  const [entityLinkPickerOpen, setEntityLinkPickerOpen] = useState(false);
  const prevInitKeyRef = useRef(null);
  const bodyMeasureRef = useRef(null);
  const titleInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const linkButtonRef = useRef(null);
  const pendingLinkSelectionRef = useRef(null);

  const pageId =
    pageDetail?.page_id ||
    wikiPageIdFromPath(pageDetail?.file_path ?? selectedPageFilePath) ||
    "";

  const pageDetailReady =
    !pageDetailLoading &&
    !!pageDetail &&
    !!selectedPageFilePath &&
    pageDetail.file_path === selectedPageFilePath &&
    formSyncedPath === selectedPageFilePath &&
    formSyncedPath === pageDetail.file_path;

  useEffect(() => {
    if (!pageDetail) {
      setFormSyncedPath(null);
      prevInitKeyRef.current = null;
      return;
    }
    if (pageDetail.file_path !== selectedPageFilePath) {
      setFormSyncedPath(null);
      prevInitKeyRef.current = null;
      return;
    }
    const initKey = `${selectedPageFilePath}::${pageDetailLoadGeneration}`;
    if (initKey === prevInitKeyRef.current) return;
    prevInitKeyRef.current = initKey;
    setTitle(pageDetail.title ?? "");
    setBody(pageDetail.body ?? "");
    setTagsStr(Array.isArray(pageDetail.tags) ? pageDetail.tags.join(", ") : "");
    setStatus(pageDetail.status ?? "draft");
    setError("");
    setCopiedPageId(false);
    setFormSyncedPath(selectedPageFilePath);
  }, [pageDetail, selectedPageFilePath, pageDetailLoadGeneration]);

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

  const onCopyPageId = useCallback(async () => {
    const id = (pageId || "").trim();
    if (!id) return;
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedPageId(true);
      window.setTimeout(() => setCopiedPageId(false), 2000);
    }
  }, [pageId]);

  const displayTags = useMemo(
    () =>
      (tagsStr || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsStr],
  );

  const persistedTags = useMemo(() => {
    const raw = Array.isArray(allTags) ? allTags : [];
    return Array.from(
      new Set(raw.map((t) => String(t).trim()).filter(Boolean)),
    );
  }, [allTags]);

  const handleTagsChange = useCallback((tags) => {
    setTagsStr((Array.isArray(tags) ? tags : []).join(", "));
  }, []);

  const draft = useMemo(
    () => ({ title, body, tags: displayTags, status }),
    [title, body, displayTags, status],
  );

  const persistedSnapshot = useMemo(
    () => ({
      title: pageDetail?.title ?? "",
      body: pageDetail?.body ?? "",
      tags: Array.isArray(pageDetail?.tags) ? pageDetail.tags : [],
      status: pageDetail?.status ?? "draft",
    }),
    [pageDetail],
  );

  const handleAutoSave = useCallback(
    async (d) => {
      const targetPath = pageDetail?.file_path;
      if (!targetPath || !onSave) return;
      setError("");
      try {
        await onSave({
          file_path: targetPath,
          title: d.title.trim(),
          tags: Array.isArray(d.tags) ? d.tags : [],
          status: d.status,
          body: d.body,
        });
      } catch (err) {
        setError(err?.message || "Auto-save failed");
      }
    },
    [onSave, pageDetail?.file_path],
  );

  const { flush, saving } = useDebouncedAutoSave({
    enabled: isEditing && !!selectedPageFilePath && pageDetailReady,
    key: selectedPageFilePath,
    draft,
    persisted: persistedSnapshot,
    normalize: normalizeWikiDraft,
    save: handleAutoSave,
    delayMs: DEBOUNCE_MS,
    silent: true,
  });

  useEffect(() => registerAutoSaveFlush(flush), [flush]);

  // Immediate tag persistence: when tags change, flush now (debounce is still safe
  // because useDebouncedAutoSave compares draft vs persisted).
  useEffect(() => {
    if (!isEditing || readOnly) return;
    void flush();
  }, [tagsStr, isEditing, readOnly, flush]);

  useEffect(() => {
    if (!isEditing || readOnly) return;
    void flush();
  }, [status, isEditing, readOnly, flush]);

  const { getLiveEditorProps, toolbarProps, insertAtCursor, liveEditorRef } =
    useMarkdownEditor(body, setBody, {
      onBlur: flush,
      disabled: false,
      growWithContent: true,
      initialHeight: measuredBodyHeight ?? undefined,
      livePreview: true,
      repoSlug,
    });

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

  const capturePendingSelection = useCallback(() => {
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
  }, [liveEditorRef]);

  const handleInsertEntityLinkClick = useCallback(() => {
    if (!repoSlug) return;
    capturePendingSelection();
    setEntityLinkPickerOpen((open) => !open);
  }, [repoSlug, capturePendingSelection]);

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
      const rowTitle = (item?.title || "").trim();
      const snippet =
        item.kind === "wiki"
          ? formatWikiPageLink(id, selectedLabel || rowTitle)
          : formatWikiTicketLink(id, selectedLabel || rowTitle);
      applyLinkSnippet(snippet);
      setEntityLinkPickerOpen(false);
    },
    [applyLinkSnippet],
  );

  if (selectedPageFilePath && pageDetailLoading && !pageDetail) {
    return (
      <DetailPanel>
        <div className="flex min-h-[12rem] flex-1 items-center justify-center px-4 text-sm text-slate-500 dark:text-slate-400">
          Loading page…
        </div>
      </DetailPanel>
    );
  }

  if (!pageDetail) {
    return (
      <DetailPanel>
        <DetailPanelEmpty
          iconComponent={WikiPageIcon}
          title="Select a wiki page from the tree"
          description="or create a new one with New page"
          action={
            onStartCreate ? (
              <button
                type="button"
                onClick={onStartCreate}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                New page
              </button>
            ) : undefined
          }
        />
      </DetailPanel>
    );
  }

  const folderTitle =
    wikiFolderFromPath(pageDetail?.file_path ?? selectedPageFilePath)?.replace(
      /^\.gitoza\/wiki\/?/,
      "",
    ) || "Wiki";

  const copyPageIdButton = (
    <Tooltip label={copiedPageId ? "Copied" : "Copy ID"} placement="bottom">
      <button
        type="button"
        onClick={onCopyPageId}
        disabled={!pageId}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
        aria-label={copiedPageId ? "Copied" : "Copy page ID"}
      >
        {copiedPageId ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <ClipboardCopy className="h-4 w-4" aria-hidden />
        )}
      </button>
    </Tooltip>
  );

  if (!isEditing && pageDetail) {
    return (
      <DetailPanel
        title={<span className="text-sm text-slate-600 dark:text-slate-300">{folderTitle}</span>}
        bodyScroll={false}
      >
        <WikiDetailView
          page={{ ...pageDetail, body: body ?? pageDetail.body }}
          repoSlug={repoSlug}
          onOpenTicket={onOpenTicket}
          onOpenWikiPage={onOpenWikiPage}
          pageIdRowExtra={
            <>
              {copyPageIdButton}
              {!readOnly ? (
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
              ) : null}
            </>
          }
        />
      </DetailPanel>
    );
  }

  const bodyEditorProps = getLiveEditorProps({
    placeholder: "Write wiki content in Markdown. Use ```mermaid fences for diagrams…",
    "aria-label": "Wiki body (Markdown)",
    className:
      "min-h-[7.5rem] w-full overflow-y-hidden resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500",
    measureRef: bodyMeasureRef,
  });

  const wikiHeader = (
    <header className="relative z-20 border-b border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled page"
          className={`${inlineCls} min-w-0 flex-1 rounded border border-indigo-200 bg-white text-lg font-bold leading-snug text-slate-900 outline-none ring-indigo-400 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 dark:border-indigo-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600`}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-0.5">
          <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
            {pageId || "—"}
          </span>
          {copyPageIdButton}
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
              await flush();
              onToggleEdit?.(false, {
                title,
                body,
                tags: displayTags,
                status,
              });
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

  const wikiMetadataStrip = (
    <div className="flex flex-wrap items-stretch gap-2">
      <MetadataFieldEdit label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={readOnly}
          className={`${METADATA_EDIT_INPUT_CLS} ${METADATA_EDIT_INPUT_DEFAULT_CLS} cursor-pointer appearance-none pr-7 shadow-sm`}
        >
          {WIKI_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </MetadataFieldEdit>
      <MetadataFieldEdit label="Tags" className="min-w-[12rem]">
        <TagsInput
          value={displayTags}
          onChange={handleTagsChange}
          options={persistedTags}
          disabled={readOnly}
        />
      </MetadataFieldEdit>
    </div>
  );

  return (
    <DetailPanel
      title={<span className="text-sm text-slate-600 dark:text-slate-300">{folderTitle}</span>}
      bodyScroll={false}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <StickyThenScroll
          stickyContent={wikiHeader}
          scrollContent={
            <>
              <div className="px-3 pb-2 pt-3">{wikiMetadataStrip}</div>
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
                  excludePageId={pageId}
                  onSelect={handleEntityLinkSelect}
                />
              </div>
              <div className="px-3 pb-3 pt-2">
                <BodyMarkdownEditor {...bodyEditorProps} />
              </div>
            </>
          }
        />
        {(error || pageDetail?.updated_at || pageDetail?.updated_by) && (
          <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
            {error ? (
              <div className="mb-1 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            ) : null}
            <UpdatedByLine updatedAt={pageDetail?.updated_at} updatedBy={pageDetail?.updated_by} />
          </footer>
        )}
      </div>
    </DetailPanel>
  );
}

export default WikiEditorPanel;
