import {
  Bold,
  Code2,
  Heading,
  Image,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Table2,
  Workflow,
} from "lucide-react";
import Tooltip from "./Tooltip";
import { MARKDOWN_EDITOR_MODES } from "../utils/markdownSmartPaste";

const btnCls =
  "rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-300";

const modeBtnBase =
  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40";
const modeBtnIdle =
  "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-300";
const modeBtnActive =
  "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300";

const BLOCKED_IN_TABLE_LABEL = "Not supported inside tables";

/**
 * Custom tooltip wrapper for toolbar icons (no native title — avoids double tips).
 * Span keeps hover working when the child button is disabled.
 */
function ToolbarIconTip({ label, children }) {
  return (
    <Tooltip label={label} placement="bottom">
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}

/**
 * Reusable Markdown format toolbar (Bold, Heading, lists, Table, …).
 * Use with useMarkdownEditor; place in sticky area so it stays visible while body scrolls.
 */
export default function MarkdownToolbar({
  onBold,
  onHeading,
  onBulletList,
  onNumberedList,
  onChecklist,
  onInsertTable,
  onInsertCode,
  onInsertMermaid,
  onInsertImage,
  onInsertEntityLink,
  entityLinkDisabled = false,
  entityLinkActive = false,
  entityLinkButtonRef = null,
  disabled = false,
  blockFormatsInTable = false,
  imageDisabled = false,
  imageSyncBlocked = false,
  imageTooltip = null,
  onImageConfigureClick = null,
  className = "",
  rightContent = null,
  editorMode = MARKDOWN_EDITOR_MODES.normal,
  onEditorModeChange = null,
}) {
  const blockInTable = Boolean(blockFormatsInTable);
  const blockFmtDisabled = disabled || blockInTable;
  const headingListTip = blockInTable ? BLOCKED_IN_TABLE_LABEL : null;

  const imageBtn = onInsertImage ? (
    <button
      type="button"
      onClick={imageSyncBlocked ? onImageConfigureClick : onInsertImage}
      disabled={!imageSyncBlocked && (disabled || imageDisabled)}
      className={`${btnCls} ${imageSyncBlocked ? "cursor-pointer opacity-40" : ""}`}
      aria-label="Insert image"
      aria-disabled={imageSyncBlocked || disabled || imageDisabled}
    >
      <Image className="h-3.5 w-3.5" />
    </button>
  ) : null;

  const linkBtn = onInsertEntityLink ? (
    <ToolbarIconTip label="Insert link">
      <button
        ref={entityLinkButtonRef}
        type="button"
        onClick={onInsertEntityLink}
        disabled={disabled || entityLinkDisabled}
        className={`${btnCls} ${
          entityLinkActive
            ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
            : ""
        }`}
        aria-label="Insert link"
        aria-pressed={entityLinkActive}
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </ToolbarIconTip>
  ) : null;

  const modeToggle =
    typeof onEditorModeChange === "function" ? (
      <div
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-slate-200 p-0.5 dark:border-slate-600"
        role="group"
        aria-label="Editor mode"
      >
        <Tooltip label="Edit as formatted text (like view)" placement="bottom">
          <button
            type="button"
            onClick={() => onEditorModeChange(MARKDOWN_EDITOR_MODES.normal)}
            disabled={disabled}
            className={`${modeBtnBase} ${
              editorMode === MARKDOWN_EDITOR_MODES.normal ? modeBtnActive : modeBtnIdle
            }`}
            aria-pressed={editorMode === MARKDOWN_EDITOR_MODES.normal}
          >
            Normal
          </button>
        </Tooltip>
        <Tooltip label="Edit raw Markdown" placement="bottom">
          <button
            type="button"
            onClick={() => onEditorModeChange(MARKDOWN_EDITOR_MODES.markdown)}
            disabled={disabled}
            className={`${modeBtnBase} ${
              editorMode === MARKDOWN_EDITOR_MODES.markdown ? modeBtnActive : modeBtnIdle
            }`}
            aria-pressed={editorMode === MARKDOWN_EDITOR_MODES.markdown}
          >
            Markdown
          </button>
        </Tooltip>
      </div>
    ) : null;

  const tableBtn =
    typeof onInsertTable === "function" ? (
      <ToolbarIconTip label="Insert table">
        <button
          type="button"
          onClick={onInsertTable}
          disabled={disabled}
          className={btnCls}
          aria-label="Insert table"
        >
          <Table2 className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
    ) : null;

  const codeBtn =
    typeof onInsertCode === "function" ? (
      <ToolbarIconTip label="Insert code">
        <button
          type="button"
          onClick={onInsertCode}
          disabled={disabled}
          className={btnCls}
          aria-label="Insert code"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
    ) : null;

  const mermaidBtn =
    typeof onInsertMermaid === "function" ? (
      <ToolbarIconTip label="Insert Mermaid diagram">
        <button
          type="button"
          onClick={onInsertMermaid}
          disabled={disabled}
          className={btnCls}
          aria-label="Insert Mermaid diagram"
        >
          <Workflow className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
    ) : null;

  return (
    <div
      className={`flex items-center gap-0.5 border-b border-slate-200 bg-white pb-1 dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      <ToolbarIconTip label="Bold">
        <button
          type="button"
          onClick={onBold}
          disabled={disabled}
          className={btnCls}
          aria-label="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
      <ToolbarIconTip label={headingListTip || "Heading"}>
        <button
          type="button"
          onClick={onHeading}
          disabled={blockFmtDisabled}
          className={btnCls}
          aria-label="Heading"
        >
          <Heading className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
      <ToolbarIconTip label={headingListTip || "Bullet list"}>
        <button
          type="button"
          onClick={onBulletList}
          disabled={blockFmtDisabled}
          className={btnCls}
          aria-label="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
      <ToolbarIconTip label={headingListTip || "Numbered list"}>
        <button
          type="button"
          onClick={onNumberedList}
          disabled={blockFmtDisabled}
          className={btnCls}
          aria-label="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
      <ToolbarIconTip label={headingListTip || "Checklist"}>
        <button
          type="button"
          onClick={onChecklist}
          disabled={blockFmtDisabled}
          className={btnCls}
          aria-label="Checklist"
        >
          <ListTodo className="h-3.5 w-3.5" />
        </button>
      </ToolbarIconTip>
      {tableBtn}
      {codeBtn}
      {mermaidBtn}
      {linkBtn}
      {imageBtn ? (
        <div className="inline-flex items-center gap-1">
          <ToolbarIconTip
            label={
              imageSyncBlocked && imageTooltip
                ? imageTooltip
                : "Insert image"
            }
          >
            {imageBtn}
          </ToolbarIconTip>
          {imageSyncBlocked && onImageConfigureClick ? (
            <button
              type="button"
              onClick={onImageConfigureClick}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Configure
            </button>
          ) : null}
        </div>
      ) : null}
      {rightContent ? (
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">{rightContent}</div>
      ) : modeToggle ? (
        <div className="min-w-0 flex-1" aria-hidden />
      ) : null}
      {modeToggle ? <div className="ml-1 shrink-0">{modeToggle}</div> : null}
    </div>
  );
}
