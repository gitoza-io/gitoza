import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import GitozaImageView from "./GitozaImageView";

/**
 * Block image node for Gitoza asset embeds (`![alt](img_….png)`).
 * Reuses ResizableImage via NodeView; Markdown I/O comes from TipTap Image + @tiptap/markdown.
 */
export const GitozaImage = Image.extend({
  name: "image",

  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: false,
      repoSlug: null,
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(GitozaImageView);
  },
});

export default GitozaImage;
