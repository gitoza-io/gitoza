import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  createVisualMarkdownExtensions,
  normalizeMarkdownForCompare,
} from "../utils/visualMarkdownExtensions";
import { isGfmPipeTableMarkdown } from "../utils/markdownSmartPaste";
import { unescapeMarkdownWikiLinks } from "../utils/ticketLinks";
import { unescapeTipTapMarkdown } from "../utils/unescapeTipTapMarkdown";
import { escapeWikiLinkPipesForGfm } from "../utils/gfmPipeTable";
import VisualTableFloatingBar from "./VisualTableFloatingBar";

/**
 * @param {import('@tiptap/core').Editor} editor
 * @returns {string}
 */
function editorMarkdown(editor) {
  return unescapeTipTapMarkdown(editor.getMarkdown());
}

/**
 * Prefer plain-text insert for wiki links so TipTap does not treat `[[` as markdown punctuation.
 * @param {string} raw
 * @returns {boolean}
 */
function shouldInsertAsPlainText(raw) {
  return raw.includes("[[") || raw.includes("\\[[");
}

/**
 * When clipboard plain contains a GFM pipe table, TipTap must not paste HTML
 * (Cursor Copy message often wraps each row in `<p>` → blank lines / broken tables).
 * @param {string | null | undefined} plain
 * @returns {string | null} markdown to insert, or null to let TipTap handle paste
 */
export function resolveVisualMarkdownPaste(plain) {
  const plainText = plain == null ? "" : String(plain);
  if (!isGfmPipeTableMarkdown(plainText)) return null;
  return plainText;
}

/**
 * TipTap/ProseMirror rejects some mark combos the Markdown parser emits
 * (notably `link` + `code` on the same text). Strip incompatible marks.
 * @param {import('@tiptap/core').JSONContent} node
 * @returns {import('@tiptap/core').JSONContent}
 */
export function sanitizeParsedMarkdownJson(node) {
  if (!node || typeof node !== "object") return node;
  let next = node;
  if (next.type === "text" && Array.isArray(next.marks) && next.marks.length > 1) {
    const types = new Set(next.marks.map((m) => m?.type).filter(Boolean));
    if (types.has("link") && types.has("code")) {
      next = {
        ...next,
        marks: next.marks.filter((m) => m?.type !== "code"),
      };
    }
  }
  if (Array.isArray(next.content)) {
    next = {
      ...next,
      content: next.content.map((child) => sanitizeParsedMarkdownJson(child)),
    };
  }
  return next;
}

/**
 * Insert Markdown at the cursor via TipTap's Markdown manager.
 * `insertContent(str, { contentType: "markdown" })` often no-ops; parse → JSON nodes instead.
 * Escapes `|` inside wikilinks so GFM tables do not split cells.
 * @param {import('@tiptap/core').Editor} editor
 * @param {string} markdown
 * @returns {boolean}
 */
export function insertMarkdownAtCursor(editor, markdown) {
  if (!editor || editor.isDestroyed) return false;
  const raw = String(markdown ?? "");
  if (!raw) return false;
  const manager = editor.storage?.markdown?.manager;
  if (!manager || typeof manager.parse !== "function") return false;
  let parsed;
  try {
    parsed = manager.parse(escapeWikiLinkPipesForGfm(raw));
  } catch {
    return false;
  }
  const nodes = parsed?.content;
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const sanitized = nodes.map((n) => sanitizeParsedMarkdownJson(n));
  try {
    const { from } = editor.state.selection;
    return editor.commands.insertContentAt(from, sanitized);
  } catch {
    return false;
  }
}

/**
 * @typedef {{
 *   focus: () => void,
 *   insertAtCursor: (text: string, cursorOffset?: number) => void,
 *   wrapSelection: (before: string, after: string) => void,
 *   getEditor: () => import('@tiptap/core').Editor | null,
 *   getTextareaRef: () => null,
 *   getSelectedText: () => string,
 *   toggleBold: () => void,
 *   toggleHeading: (level?: number) => void,
 *   toggleBulletList: () => void,
 *   toggleOrderedList: () => void,
 *   toggleTaskList: () => void,
 *   insertTable: () => void,
 *   addTableRow: () => void,
 *   addTableColumn: () => void,
 *   deleteTableRow: () => void,
 *   deleteTableColumn: () => void,
 *   isInTable: () => boolean,
 * }} VisualMarkdownEditorHandle
 */

const VisualMarkdownEditor = forwardRef(function VisualMarkdownEditor(
  {
    value = "",
    onChange,
    repoSlug = null,
    disabled = false,
    placeholder = "Write…",
    className = "",
    onBlur,
    onInTableChange,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onInTableChangeRef = useRef(onInTableChange);
  onInTableChangeRef.current = onInTableChange;
  const inTableRef = useRef(false);
  const editorRef = useRef(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const extensions = useMemo(
    () =>
      createVisualMarkdownExtensions({
        repoSlug,
        placeholder,
        withReactImage: true,
      }),
    [repoSlug, placeholder],
  );

  const editor = useEditor(
    {
      extensions,
      content: escapeWikiLinkPipesForGfm(value || ""),
      contentType: "markdown",
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: [
            "prose-rex visual-md-editor min-h-[7.5rem] w-full outline-none",
            "text-sm leading-relaxed text-ink dark:text-slate-100",
            className,
          ]
            .filter(Boolean)
            .join(" "),
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        },
        handlePaste: (_view, event) => {
          if (disabledRef.current) return false;
          const cd = event.clipboardData;
          if (!cd) return false;
          // Image / file paste: leave to TipTap / browser.
          if (cd.files && cd.files.length > 0) return false;

          const markdown = resolveVisualMarkdownPaste(cd.getData("text/plain"));
          if (!markdown) return false;

          const ed = editorRef.current;
          if (!ed) return false;

          // Own the event; insert outside ProseMirror's paste transaction.
          event.preventDefault();
          queueMicrotask(() => {
            const active = editorRef.current;
            if (!active || active.isDestroyed) return;
            insertMarkdownAtCursor(active, markdown);
          });
          return true;
        },
      },
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed;
      },
      onUpdate: ({ editor: ed }) => {
        if (typeof onChange !== "function") return;
        const next = editorMarkdown(ed);
        if (
          normalizeMarkdownForCompare(next) ===
          normalizeMarkdownForCompare(valueRef.current)
        ) {
          return;
        }
        onChange(next);
      },
      onBlur: () => {
        onBlur?.();
      },
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) {
      if (inTableRef.current) {
        inTableRef.current = false;
        onInTableChangeRef.current?.(false);
      }
      return undefined;
    }

    const report = () => {
      const next = editor.isActive("table");
      if (next === inTableRef.current) return;
      inTableRef.current = next;
      onInTableChangeRef.current?.(next);
    };

    report();
    editor.on("selectionUpdate", report);
    editor.on("transaction", report);
    return () => {
      editor.off("selectionUpdate", report);
      editor.off("transaction", report);
      if (inTableRef.current) {
        inTableRef.current = false;
        onInTableChangeRef.current?.(false);
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const incoming = value ?? "";
    const current = editorMarkdown(editor);
    if (
      normalizeMarkdownForCompare(current) ===
      normalizeMarkdownForCompare(incoming)
    ) {
      return;
    }
    editor.commands.setContent(escapeWikiLinkPipesForGfm(incoming), {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.chain()?.focus()?.run();
      },
      getTextareaRef: () => null,
      getSelectedText: () => {
        if (!editor) return "";
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, "");
      },
      insertAtCursor: (text) => {
        if (!editor) return;
        const raw = String(text ?? "");
        if (!raw) return;
        if (shouldInsertAsPlainText(raw)) {
          const plain = unescapeMarkdownWikiLinks(raw);
          editor.chain().focus().insertContent(plain).run();
          return;
        }
        editor
          .chain()
          .focus()
          .insertContent(escapeWikiLinkPipesForGfm(raw), {
            contentType: "markdown",
          })
          .run();
      },
      wrapSelection: (before, after) => {
        if (!editor) return;
        if (before === "**" && after === "**") {
          editor.chain().focus().toggleBold().run();
          return;
        }
        if (before === "*" && after === "*") {
          editor.chain().focus().toggleItalic().run();
          return;
        }
        if (before === "`" && after === "`") {
          editor.chain().focus().toggleCode().run();
          return;
        }
        const { from, to } = editor.state.selection;
        const selected = editor.state.doc.textBetween(from, to, "");
        const inserted = selected
          ? `${before}${selected}${after}`
          : `${before}${after}`;
        if (shouldInsertAsPlainText(inserted)) {
          editor
            .chain()
            .focus()
            .insertContent(unescapeMarkdownWikiLinks(inserted))
            .run();
          return;
        }
        editor
          .chain()
          .focus()
          .insertContent(escapeWikiLinkPipesForGfm(inserted), {
            contentType: "markdown",
          })
          .run();
      },
      getEditor: () => editor,
      toggleBold: () => {
        editor?.chain()?.focus()?.toggleBold()?.run();
      },
      toggleHeading: (level = 2) => {
        editor?.chain()?.focus()?.toggleHeading({ level })?.run();
      },
      toggleBulletList: () => {
        editor?.chain()?.focus()?.toggleBulletList()?.run();
      },
      toggleOrderedList: () => {
        editor?.chain()?.focus()?.toggleOrderedList()?.run();
      },
      toggleTaskList: () => {
        editor?.chain()?.focus()?.toggleTaskList()?.run();
      },
      insertTable: () => {
        editor
          ?.chain()
          ?.focus()
          ?.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          ?.run();
      },
      addTableRow: () => {
        editor?.chain()?.focus()?.addRowAfter()?.run();
      },
      addTableColumn: () => {
        editor?.chain()?.focus()?.addColumnAfter()?.run();
      },
      deleteTableRow: () => {
        editor?.chain()?.focus()?.deleteRow()?.run();
      },
      deleteTableColumn: () => {
        editor?.chain()?.focus()?.deleteColumn()?.run();
      },
      isInTable: () => Boolean(editor?.isActive("table")),
    }),
    [editor],
  );

  return (
    <div className="relative w-full">
      <EditorContent editor={editor} />
      <VisualTableFloatingBar editor={editor} disabled={disabled} />
    </div>
  );
});

export default VisualMarkdownEditor;
