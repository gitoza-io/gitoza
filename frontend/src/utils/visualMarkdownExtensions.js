import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { TaskList } from "@tiptap/extension-list/task-list";
import { GitozaImage } from "../components/GitozaImageExtension";
import { unescapeTipTapMarkdown } from "./unescapeTipTapMarkdown";

/**
 * TipTap extensions for Visual Normal mode (Markdown round-trip).
 * @param {{
 *   repoSlug?: string | null,
 *   placeholder?: string,
 *   withReactImage?: boolean,
 * }} [options]
 */
export function createVisualMarkdownExtensions(options = {}) {
  const {
    repoSlug = null,
    placeholder = "Write…",
    withReactImage = true,
  } = options;

  const ImageExt = withReactImage
    ? GitozaImage.configure({
        inline: false,
        allowBase64: false,
        repoSlug,
      })
    : Image.configure({
        inline: false,
        allowBase64: false,
      });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: {
        HTMLAttributes: {
          class:
            "my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs dark:border-slate-600 dark:bg-slate-900/50",
        },
      },
      // StarterKit already includes Link — configure it here (do not add Link twice).
      link: {
        openOnClick: false,
        HTMLAttributes: {
          class:
            "text-indigo-600 underline decoration-indigo-400/60 dark:text-indigo-400",
        },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ImageExt,
    Table.configure({
      resizable: false,
      HTMLAttributes: {
        class: "visual-md-table",
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({
      placeholder,
      emptyEditorClass: "is-editor-empty",
    }),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ];
}

/**
 * Normalize Markdown for equality checks (unescape TipTap serializer noise,
 * then trim trailing whitespace per line).
 * @param {string | null | undefined} md
 * @returns {string}
 */
export function normalizeMarkdownForCompare(md) {
  return unescapeTipTapMarkdown(md)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "")
    .trim();
}
