import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderCog, LayoutTemplate, Loader2, Undo2, File } from "lucide-react";
import SidebarRow from "./SidebarRow";
import ChangeStatusBadge from "./ChangeStatusBadge";
import CaseRowLabel from "./CaseRowLabel";
import Tooltip from "./Tooltip";
import { TestCaseIcon, TestRunIcon, TicketTypeIcon, WikiPageIcon } from "./TestEntityIcons";
import {
  VIRTUAL_CASE_LIST_OVERSCAN,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList";
import {
  CONFIRM_CHANGES_EMPTY_HINT,
  CONFIRM_CHANGES_EMPTY_TITLE,
} from "../copy/longOperationCopy";
import { estimateChangelistRowHeight } from "../utils/confirmChangesChangelist";
import { flexFillScroll } from "../utils/layoutClasses";

const TEMPLATES_PREFIX = ".gitoza/test/templates/";

function templateDisplayName(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/");
  if (normalized.startsWith(TEMPLATES_PREFIX)) {
    const base = normalized.split("/").pop() || normalized;
    return base.replace(/\.md$/i, "") || filePath;
  }
  return filePath;
}

function DiscardIconButton({ label, onClick, disabled = false }) {
  return (
    <Tooltip label={label} placement="bottom">
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) onClick?.(e);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-rose-600 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-rose-400"
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

function SectionHeaderRow({ title, count, sectionId, canDiscard = true, onDiscardSection, discardDisabled }) {
  return (
    <div className="group flex shrink-0 items-center gap-1 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      <span className="min-w-0 flex-1 truncate">
        {title} ({count})
      </span>
      {onDiscardSection && sectionId && canDiscard ? (
        <DiscardIconButton
          label={`Discard all changes in ${title}`}
          disabled={discardDisabled}
          onClick={() => onDiscardSection(sectionId)}
        />
      ) : null}
    </div>
  );
}

function rowActions({ badge, discardLabel, onDiscard, discardDisabled }) {
  if (!onDiscard && !badge) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {onDiscard ? (
        <DiscardIconButton
          label={discardLabel}
          disabled={discardDisabled}
          onClick={onDiscard}
        />
      ) : null}
      {badge}
    </span>
  );
}

function ChangelistRow({
  entry,
  selectionKind,
  selectedCasePath,
  selectedRunDir,
  selectedOtherPath,
  onSelectCase,
  onSelectRunGroup,
  onSelectOther,
  onDiscardEntry,
  onDiscardSection,
  discardDisabled,
}) {
  if (entry.kind === "sectionHeader") {
    return (
      <SectionHeaderRow
        title={entry.title}
        count={entry.count}
        sectionId={entry.sectionId}
        canDiscard={entry.canDiscard !== false}
        onDiscardSection={onDiscardSection}
        discardDisabled={discardDisabled}
      />
    );
  }

  if (entry.kind === "case") {
    const isDeleted = entry.status === "D";
    const labelPath = isDeleted && entry.old_path ? entry.old_path : entry.file_path;
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "caseFolder" && selectedCasePath === entry.file_path}
        icon={<TestCaseIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        label={
          <CaseRowLabel
            title={entry.label || labelPath}
            caseId={entry.caseRow?.case_id}
            deleted={isDeleted}
          />
        }
        right={rowActions({
          badge: (
            <ChangeStatusBadge
              status={entry.status}
              path={entry.file_path}
              oldPath={entry.old_path}
            />
          ),
          discardLabel: `Discard changes in "${entry.label || labelPath}"`,
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectCase(entry.file_path)}
      />
    );
  }

  if (entry.kind === "runGroup") {
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "runGroup" && selectedRunDir === entry.runDir}
        icon={<TestRunIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />}
        label={
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm">{entry.title}</span>
            {entry.subtitle ? (
              <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                {entry.subtitle}
              </span>
            ) : null}
          </span>
        }
        right={rowActions({
          discardLabel: `Discard all changes for run "${entry.title}"`,
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectRunGroup(entry.runDir)}
      />
    );
  }

  if (entry.kind === "ticket") {
    const isDeleted = entry.status === "D";
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "other" && selectedOtherPath === entry.path}
        icon={<TicketTypeIcon type={entry.type || "task"} />}
        label={
          <CaseRowLabel
            title={entry.title || entry.label}
            caseId={entry.ticket_id}
            showCaseId={false}
            deleted={isDeleted}
          />
        }
        right={rowActions({
          badge: entry.status ? (
            <ChangeStatusBadge
              status={entry.status}
              path={entry.path}
              oldPath={entry.old_path}
            />
          ) : null,
          discardLabel: `Discard changes in "${entry.title || entry.label}"`,
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectOther(entry.path)}
      />
    );
  }

  if (entry.kind === "wiki") {
    const isDeleted = entry.status === "D";
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "other" && selectedOtherPath === entry.path}
        icon={<WikiPageIcon />}
        label={
          <CaseRowLabel
            title={entry.title || entry.label}
            caseId={entry.page_id}
            showCaseId={false}
            deleted={isDeleted}
          />
        }
        right={rowActions({
          badge: entry.status ? (
            <ChangeStatusBadge
              status={entry.status}
              path={entry.path}
              oldPath={entry.old_path}
            />
          ) : null,
          discardLabel: `Discard changes in "${entry.title || entry.label}"`,
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectOther(entry.path)}
      />
    );
  }

  if (entry.kind === "template") {
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "other" && selectedOtherPath === entry.path}
        icon={<LayoutTemplate className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
        label={<span className="truncate text-sm">{templateDisplayName(entry.path)}</span>}
        right={rowActions({
          discardLabel: `Discard changes in "${templateDisplayName(entry.path)}"`,
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectOther(entry.path)}
      />
    );
  }

  if (entry.kind === "config") {
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "other" && selectedOtherPath === entry.path}
        icon={<FolderCog className="h-4 w-4 text-slate-600 dark:text-slate-400" />}
        label={<span className="truncate text-sm">Project config</span>}
        right={rowActions({
          discardLabel: 'Discard changes in "Project config"',
          onDiscard: onDiscardEntry ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectOther(entry.path)}
      />
    );
  }

  if (entry.kind === "other") {
    const isDeleted = entry.status === "D";
    const labelPath = isDeleted && entry.old_path ? entry.old_path : entry.path;
    const canDiscard = entry.discardable !== false;
    return (
      <SidebarRow
        className="group"
        selected={selectionKind === "other" && selectedOtherPath === entry.path}
        icon={<File className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
        label={
          <span
            className={`truncate text-sm ${isDeleted ? "line-through text-slate-400 dark:text-slate-500" : ""}`}
          >
            {labelPath}
          </span>
        }
        right={rowActions({
          badge: entry.status ? (
            <ChangeStatusBadge
              status={entry.status}
              path={entry.path}
              oldPath={entry.old_path}
            />
          ) : null,
          discardLabel: `Discard changes in "${labelPath}"`,
          onDiscard: onDiscardEntry && canDiscard ? () => onDiscardEntry(entry) : null,
          discardDisabled,
        })}
        onClick={() => onSelectOther(entry.path)}
      />
    );
  }

  return null;
}

function VirtualChangelistRows({
  entries,
  selectionKind,
  selectedCasePath,
  selectedRunDir,
  selectedOtherPath,
  onSelectCase,
  onSelectRunGroup,
  onSelectOther,
  onDiscardEntry,
  onDiscardSection,
  discardDisabled,
}) {
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateChangelistRowHeight(entries[index]),
    overscan: VIRTUAL_CASE_LIST_OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${flexFillScroll}`}>
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((virtualRow) => {
          const entry = entries[virtualRow.index];
          const measureRef = (el) => {
            if (el) virtualizer.measureElement(el);
          };
          return (
            <div
              key={entry.id}
              data-index={virtualRow.index}
              ref={measureRef}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ChangelistRow
                entry={entry}
                selectionKind={selectionKind}
                selectedCasePath={selectedCasePath}
                selectedRunDir={selectedRunDir}
                selectedOtherPath={selectedOtherPath}
                onSelectCase={onSelectCase}
                onSelectRunGroup={onSelectRunGroup}
                onSelectOther={onSelectOther}
                onDiscardEntry={onDiscardEntry}
                onDiscardSection={onDiscardSection}
                discardDisabled={discardDisabled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StaticChangelistRows(props) {
  const { entries } = props;
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${flexFillScroll}`}>
      {entries.map((entry) => (
        <ChangelistRow key={entry.id} entry={entry} {...props} />
      ))}
    </div>
  );
}

/**
 * VS Code-style flat changelist for Confirm Changes.
 */
function ConfirmChangesChangelist({
  entries = [],
  selectionKind,
  selectedCasePath,
  selectedRunDir,
  selectedOtherPath,
  onSelectCase,
  onSelectRunGroup,
  onSelectOther,
  onDiscardEntry,
  onDiscardSection,
  discardDisabled = false,
  loading = false,
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-1 px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-600 dark:text-slate-300">
          {CONFIRM_CHANGES_EMPTY_TITLE}
        </p>
        <p>{CONFIRM_CHANGES_EMPTY_HINT}</p>
      </div>
    );
  }

  const rowProps = {
    selectionKind,
    selectedCasePath,
    selectedRunDir,
    selectedOtherPath,
    onSelectCase,
    onSelectRunGroup,
    onSelectOther,
    onDiscardEntry,
    onDiscardSection,
    discardDisabled,
  };

  const useVirtual = entries.length >= VIRTUAL_CASE_LIST_THRESHOLD;

  return useVirtual ? (
    <VirtualChangelistRows entries={entries} {...rowProps} />
  ) : (
    <StaticChangelistRows entries={entries} {...rowProps} />
  );
}

export default ConfirmChangesChangelist;
