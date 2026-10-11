import { NodeViewWrapper } from "@tiptap/react";
import ResizableImage from "./ResizableImage";
import { isTauri } from "../utils/tauriEnv";
import {
  formatMarkdownImageAlt,
} from "../utils/markdownImageLine";
import { parseMarkdownImageAlt } from "../utils/parseMarkdownImageAlt";

/**
 * TipTap NodeView for local asset images in Visual Normal mode.
 */
export default function GitozaImageView({
  node,
  updateAttributes,
  deleteNode,
  extension,
  editor,
}) {
  const fileName = String(node.attrs?.src ?? "").trim();
  const alt = node.attrs?.alt ?? "";
  const repoSlug = extension?.options?.repoSlug ?? null;
  const editable = Boolean(editor?.isEditable);

  if (!fileName) {
    return (
      <NodeViewWrapper as="div" className="my-1" data-drag-handle>
        <p className="text-xs text-slate-500">Missing image</p>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="my-1" data-drag-handle>
      <ResizableImage
        repoSlug={repoSlug}
        fileName={fileName}
        alt={alt}
        resizable={editable && isTauri() && Boolean(repoSlug)}
        disabled={!editable}
        onWidthChange={
          editable
            ? (px) => {
                const { label } = parseMarkdownImageAlt(alt);
                updateAttributes({
                  alt: formatMarkdownImageAlt(label, px),
                });
              }
            : undefined
        }
        onRemove={editable ? () => deleteNode() : undefined}
      />
    </NodeViewWrapper>
  );
}
