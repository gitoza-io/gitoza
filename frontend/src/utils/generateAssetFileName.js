const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * @param {string} [mimeType]
 * @returns {string} e.g. img_a1b2c3d4.png
 */
export function generateAssetFileName(mimeType) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
  const ext = MIME_EXT[mimeType] || "png";
  return `img_${id}.${ext}`;
}
