import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "../utils/tauriEnv";

/**
 * Trigger download of a string as a file (web fallback).
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function triggerDownload(content, filename, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Trigger download of binary data as a file (web fallback).
 * @param {Uint8Array | ArrayBuffer | number[]} bytes
 * @param {string} filename
 * @param {string} mimeType
 */
function triggerBinaryDownload(bytes, filename, mimeType) {
  const binary = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const blob = new Blob([binary], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {string} filename
 * @returns {string | null}
 */
function extensionFromFilename(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * @param {string} defaultFilename
 * @returns {Promise<string | null>}
 */
async function pickSavePath(defaultFilename) {
  const ext = extensionFromFilename(defaultFilename);
  const filters = ext
    ? [{ name: `${ext.toUpperCase()} files`, extensions: [ext] }]
    : undefined;
  return save({ defaultPath: defaultFilename, filters });
}

/**
 * Save text content via native Save As dialog (Tauri) or browser download.
 * @param {string} content
 * @param {string} defaultFilename
 * @param {string} [mimeType]
 * @returns {Promise<boolean>} true if saved, false if cancelled
 */
export async function saveTextWithDialog(
  content,
  defaultFilename,
  mimeType = "text/csv;charset=utf-8",
) {
  if (!isTauri()) {
    triggerDownload(content, defaultFilename, mimeType);
    return true;
  }
  const path = await pickSavePath(defaultFilename);
  if (!path) return false;
  await writeFile(path, new TextEncoder().encode(content));
  return true;
}

/**
 * Save binary content via native Save As dialog (Tauri) or browser download.
 * @param {Uint8Array | ArrayBuffer | number[]} bytes
 * @param {string} defaultFilename
 * @param {string} mimeType
 * @returns {Promise<boolean>} true if saved, false if cancelled
 */
export async function saveBytesWithDialog(bytes, defaultFilename, mimeType) {
  if (!isTauri()) {
    triggerBinaryDownload(bytes, defaultFilename, mimeType);
    return true;
  }
  const path = await pickSavePath(defaultFilename);
  if (!path) return false;
  const binary = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  await writeFile(path, binary);
  return true;
}

/**
 * Copy a cached asset file to a user-chosen path via native Save As dialog.
 * @param {string} sourceAbsolutePath
 * @param {string} defaultFilename
 * @returns {Promise<boolean>} true if saved, false if cancelled or unavailable
 */
export async function saveAssetFileWithDialog(sourceAbsolutePath, defaultFilename) {
  if (!isTauri() || !sourceAbsolutePath) return false;
  const path = await pickSavePath(defaultFilename);
  if (!path) return false;
  const data = await readFile(sourceAbsolutePath);
  await writeFile(path, data);
  return true;
}
