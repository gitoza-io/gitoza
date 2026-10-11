import { useMarkdownEditor } from "../hooks/useMarkdownEditor";
import MarkdownToolbar from "./MarkdownToolbar";
import BodyMarkdownEditor from "./BodyMarkdownEditor";

const DEFAULT_CLASS =
  "w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500";

/**
 * Simple Markdown editor: toolbar (Bold, Heading, Bullet list, Numbered list) and
 * Enter key continuation for lists (1. 2. 3. and - / *).
 * Controlled via value + onChange. Optional onBlur for flush.
 *
 * Layout: fillHeight = true → root fills parent (Case body); false + fixedHeight → fixed height, inner scroll;
 * growWithContent = true → no inner scroll, editor grows with content (only outer panel scrolls).
 *
 * For sticky header + toolbar and only body scroll, use useMarkdownEditor + MarkdownToolbar + StickyThenScroll instead.
 */
function SimpleMarkdownEditor({
  value = "",
  onChange,
  onBlur,
  placeholder = "Markdown…",
  className = DEFAULT_CLASS,
  disabled = false,
  "aria-label": ariaLabel,
  fillHeight = false,
  growWithContent = false,
  fixedHeight = "min-h-[12rem] max-h-[40vh]",
  repoSlug = null,
}) {
  const { toolbarProps, getLiveEditorProps } = useMarkdownEditor(value, onChange, {
    onBlur,
    disabled,
    growWithContent,
    livePreview: true,
    repoSlug,
  });

  const rootClass = fillHeight
    ? "flex min-h-0 flex-1 flex-col"
    : growWithContent
      ? "flex flex-col"
      : `flex flex-col overflow-hidden ${fixedHeight}`;

  const wrapperClass = growWithContent
    ? "min-h-[7.5rem] shrink-0"
    : "min-h-0 flex-1 overflow-y-auto shrink-0 basis-0";

  const editorClass = growWithContent
    ? `min-h-[7.5rem] w-full overflow-y-hidden ${className}`
    : `min-h-full w-full ${className}`;

  const liveEditorProps = getLiveEditorProps({
    placeholder,
    "aria-label": ariaLabel,
    className: editorClass,
    growWithContent,
  });

  return (
    <div className={rootClass}>
      <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white pb-1 dark:border-slate-700 dark:bg-slate-900">
        <MarkdownToolbar {...toolbarProps} />
      </div>
      <div className={wrapperClass}>
        <BodyMarkdownEditor {...liveEditorProps} />
      </div>
    </div>
  );
}

export default SimpleMarkdownEditor;
export { useMarkdownEditor } from "../hooks/useMarkdownEditor";
export { default as MarkdownToolbar } from "./MarkdownToolbar";
