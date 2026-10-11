import { useRef, useCallback, useEffect, useState } from "react";
import {
  continueListOnEnter,
  indentListSelection,
  outdentListSelection,
} from "../utils/markdownListEdit";
import {
  loadMarkdownEditorMode,
  MARKDOWN_EDITOR_MODES,
  normalizeMarkdownEditorMode,
  saveMarkdownEditorMode,
} from "../utils/markdownSmartPaste";
import { genericTableSnippet } from "../utils/genericTableMarkdown";
import {
  CODE_FENCE_CLOSE,
  CODE_FENCE_OPEN,
  MERMAID_FENCE_CLOSE,
  MERMAID_FENCE_OPEN,
  codeFenceCursorOffset,
  codeFenceSnippet,
  mermaidFenceCursorOffset,
  mermaidFenceSnippet,
} from "../utils/markdownFenceSnippets";

/**
 * Inserts or replaces text at selection. Returns { newValue, newCursor } (cursor after inserted text).
 */
function replaceSelection(value, start, end, inserted) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const newValue = before + inserted + after;
  const newCursor = start + inserted.length;
  return { newValue, newCursor };
}

/**
 * Shared Markdown editor logic: Normal (TipTap visual) | Markdown (raw textarea),
 * toolbar actions, insert helpers.
 *
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {{
 *   onBlur?: () => void,
 *   disabled?: boolean,
 *   growWithContent?: boolean,
 *   initialHeight?: number,
 *   livePreview?: boolean,
 *   repoSlug?: string | null,
 * }} [options]
 */
export function useMarkdownEditor(value, onChange, options = {}) {
  const {
    onBlur,
    disabled = false,
    growWithContent = false,
    initialHeight,
    livePreview = false,
    repoSlug = null,
  } = options;
  const textareaRef = useRef(null);
  /** Shared ref for BodyMarkdownEditor (Visual or Live). */
  const bodyEditorRef = useRef(null);
  const liveEditorRef = bodyEditorRef;
  const useLive = Boolean(livePreview);
  const [editorMode, setEditorModeState] = useState(() => loadMarkdownEditorMode());
  const isVisual = normalizeMarkdownEditorMode(editorMode) === MARKDOWN_EDITOR_MODES.normal;
  const [inTable, setInTable] = useState(false);

  const setEditorMode = useCallback((next) => {
    const mode = normalizeMarkdownEditorMode(next);
    setEditorModeState(mode);
    saveMarkdownEditorMode(mode);
  }, []);

  useEffect(() => {
    if (!isVisual) setInTable(false);
  }, [isVisual]);

  useEffect(() => {
    if (!growWithContent || useLive) return;
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const height = initialHeight != null ? Math.max(initialHeight, contentHeight) : contentHeight;
    el.style.height = `${height}px`;
  }, [value, growWithContent, initialHeight, useLive]);

  const insertAtCursorPlain = useCallback(
    (toInsert, cursorOffset = toInsert.length) => {
      const el = textareaRef.current;
      if (!el || typeof onChange !== "function") return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const { newValue, newCursor } = replaceSelection(value, start, end, toInsert);
      onChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const pos = newCursor + (typeof cursorOffset === "number" ? cursorOffset - toInsert.length : 0);
          textareaRef.current.setSelectionRange(pos, pos);
        }
      });
    },
    [value, onChange],
  );

  const insertAtCursor = useCallback(
    (toInsert, cursorOffset = toInsert.length) => {
      if (useLive && bodyEditorRef.current?.insertAtCursor) {
        bodyEditorRef.current.insertAtCursor(toInsert, cursorOffset);
        return;
      }
      insertAtCursorPlain(toInsert, cursorOffset);
    },
    [useLive, insertAtCursorPlain],
  );

  const wrapSelectionPlain = useCallback(
    (before, after) => {
      const el = textareaRef.current;
      if (!el || typeof onChange !== "function") return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = value.slice(start, end);
      const inserted = selected ? before + selected + after : before + after;
      const { newValue } = replaceSelection(value, start, end, inserted);
      onChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const p = start + before.length + (end - start);
          textareaRef.current.setSelectionRange(p, p);
        }
      });
    },
    [value, onChange],
  );

  const wrapSelection = useCallback(
    (before, after) => {
      if (useLive && bodyEditorRef.current?.wrapSelection) {
        bodyEditorRef.current.wrapSelection(before, after);
        return;
      }
      wrapSelectionPlain(before, after);
    },
    [useLive, wrapSelectionPlain],
  );

  const handleKeyDown = useCallback(
    (e) => {
      const el = textareaRef.current;
      if (!el || typeof onChange !== "function") return;
      const selStart = el.selectionStart;
      const selEnd = el.selectionEnd;

      if (e.key === "Tab") {
        const result = e.shiftKey
          ? outdentListSelection(value, selStart, selEnd)
          : indentListSelection(value, selStart, selEnd);
        if (!result) return;
        e.preventDefault();
        onChange(result.newValue);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(
              result.selectionStart,
              result.selectionEnd,
            );
          }
        });
        return;
      }

      if (e.key !== "Enter") return;
      if (selStart !== selEnd) return;
      const continued = continueListOnEnter(value, selStart);
      if (!continued) return;
      e.preventDefault();
      onChange(continued.newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(
            continued.newCursor,
            continued.newCursor,
          );
        }
      });
    },
    [value, onChange],
  );

  const runVisualOrMarkdown = useCallback(
    (visualFn, markdownFn) => {
      if (isVisual && bodyEditorRef.current) {
        visualFn(bodyEditorRef.current);
        return;
      }
      markdownFn();
    },
    [isVisual],
  );

  const toolbarProps = {
    onBold: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.toggleBold?.();
        },
        () => wrapSelection("**", "**"),
      ),
    onHeading: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.toggleHeading?.(2);
        },
        () => insertAtCursor("## "),
      ),
    onBulletList: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.toggleBulletList?.();
        },
        () => insertAtCursor("- "),
      ),
    onNumberedList: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.toggleOrderedList?.();
        },
        () => insertAtCursor("1. "),
      ),
    onChecklist: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.toggleTaskList?.();
        },
        () => insertAtCursor("- [ ] "),
      ),
    onInsertTable: () =>
      runVisualOrMarkdown(
        (ed) => {
          ed.insertTable?.();
        },
        () => insertAtCursor(genericTableSnippet()),
      ),
    onInsertCode: () => {
      if (isVisual) {
        const snippet = codeFenceSnippet();
        insertAtCursor(snippet, codeFenceCursorOffset());
        return;
      }
      wrapSelection(CODE_FENCE_OPEN, CODE_FENCE_CLOSE);
    },
    onInsertMermaid: () => {
      if (isVisual) {
        const snippet = mermaidFenceSnippet();
        insertAtCursor(snippet, mermaidFenceCursorOffset());
        return;
      }
      wrapSelection(MERMAID_FENCE_OPEN, MERMAID_FENCE_CLOSE);
    },
    blockFormatsInTable: isVisual && inTable,
    disabled,
    editorMode,
    onEditorModeChange: setEditorMode,
  };

  const getTextareaProps = useCallback(
    (overrides = {}) => ({
      ref: textareaRef,
      value,
      onChange: (e) => onChange(e.target.value),
      onBlur,
      onKeyDown: handleKeyDown,
      disabled,
      ...overrides,
    }),
    [value, onChange, onBlur, handleKeyDown, disabled],
  );

  const getLiveEditorProps = useCallback(
    (overrides = {}) => ({
      ref: bodyEditorRef,
      value,
      onChange,
      repoSlug,
      onBlur,
      onInTableChange: setInTable,
      disabled,
      growWithContent,
      initialHeight,
      editorMode,
      ...overrides,
    }),
    [value, onChange, repoSlug, onBlur, disabled, growWithContent, initialHeight, editorMode],
  );

  const getBodyEditorProps = getLiveEditorProps;

  return {
    toolbarProps,
    textareaRef,
    liveEditorRef,
    bodyEditorRef,
    getTextareaProps,
    getLiveEditorProps,
    getBodyEditorProps,
    insertAtCursor,
    editorMode,
    setEditorMode,
    livePreview: useLive,
    repoSlug,
  };
}
