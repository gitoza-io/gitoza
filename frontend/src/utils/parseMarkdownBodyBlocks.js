import { isAssetImageLine, IMAGE_LINE_RE } from "./markdownImageLine";

/**
 * @typedef {{ type: "text", content: string }} TextBlock
 * @typedef {{ type: "image", alt: string, fileName: string, rawLine: string, lineIndex: number }} ImageBlock
 * @typedef {TextBlock | ImageBlock} BodyBlock
 */

/**
 * @param {string | null | undefined} value
 * @returns {BodyBlock[]}
 */
export function parseMarkdownBodyBlocks(value) {
  const text = String(value ?? "");
  if (!text) return [{ type: "text", content: "" }];

  const lines = text.split("\n");
  /** @type {BodyBlock[]} */
  const blocks = [];
  /** @type {string[]} */
  let textLines = [];

  const flushText = () => {
    if (textLines.length === 0) return;
    blocks.push({ type: "text", content: textLines.join("\n") });
    textLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (isAssetImageLine(rawLine)) {
      flushText();
      const trimmed = rawLine.trim();
      const m = trimmed.match(IMAGE_LINE_RE);
      blocks.push({
        type: "image",
        alt: m?.[1] ?? "",
        fileName: String(m?.[2] ?? "").trim(),
        rawLine,
        lineIndex: i,
      });
    } else {
      textLines.push(rawLine);
    }
  }

  flushText();

  if (blocks.length === 0) {
    return [{ type: "text", content: "" }];
  }

  if (blocks[0].type === "image") {
    blocks.unshift({ type: "text", content: "" });
  }

  return blocks;
}

/**
 * @param {BodyBlock[]} blocks
 * @returns {string}
 */
export function serializeMarkdownBodyBlocks(blocks) {
  if (!blocks?.length) return "";

  const parts = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push(block.content);
    } else {
      parts.push(block.rawLine);
    }
  }

  return parts.join("\n");
}

/**
 * @param {BodyBlock[]} blocks
 * @param {number} blockIndex
 * @returns {BodyBlock[]}
 */
export function removeBodyBlockAt(blocks, blockIndex) {
  return blocks.filter((_, i) => i !== blockIndex);
}

/**
 * Replace width on an image block and return updated blocks.
 * @param {BodyBlock[]} blocks
 * @param {number} imageBlockIndex index among image blocks only, or full block index — use full block index
 * @param {number} widthPx
 * @param {(rawLine: string, widthPx: number) => string} setWidth
 * @returns {BodyBlock[]}
 */
export function updateImageBlockWidth(blocks, blockIndex, widthPx, setWidth) {
  return blocks.map((block, i) => {
    if (i !== blockIndex || block.type !== "image") return block;
    const rawLine = setWidth(block.rawLine, widthPx);
    const trimmed = rawLine.trim();
    const m = trimmed.match(IMAGE_LINE_RE);
    return {
      ...block,
      rawLine,
      alt: m?.[1] ?? block.alt,
      fileName: String(m?.[2] ?? block.fileName).trim(),
    };
  });
}
