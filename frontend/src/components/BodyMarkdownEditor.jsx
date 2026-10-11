import { forwardRef } from "react";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import VisualMarkdownEditor from "./VisualMarkdownEditor";
import {
  MARKDOWN_EDITOR_MODES,
  normalizeMarkdownEditorMode,
} from "../utils/markdownSmartPaste";

/**
 * Body editor switcher: Normal = TipTap visual; Markdown = raw LiveMarkdownEditor.
 */
const BodyMarkdownEditor = forwardRef(function BodyMarkdownEditor(
  {
    editorMode = MARKDOWN_EDITOR_MODES.normal,
    value = "",
    onChange,
    repoSlug = null,
    disabled = false,
    placeholder = "Write…",
    className = "",
    growWithContent = false,
    initialHeight,
    onBlur,
    onInTableChange,
    measureRef,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const mode = normalizeMarkdownEditorMode(editorMode);

  if (mode === MARKDOWN_EDITOR_MODES.markdown) {
    return (
      <LiveMarkdownEditor
        ref={ref}
        value={value}
        onChange={onChange}
        repoSlug={repoSlug}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        growWithContent={growWithContent}
        initialHeight={initialHeight}
        onBlur={onBlur}
        editorMode={mode}
        measureRef={measureRef}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <VisualMarkdownEditor
      ref={ref}
      value={value}
      onChange={onChange}
      repoSlug={repoSlug}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onBlur={onBlur}
      onInTableChange={onInTableChange}
      aria-label={ariaLabel}
    />
  );
});

export default BodyMarkdownEditor;
