import { openPath } from "@tauri-apps/plugin-opener";
import { isTauri } from "../utils/tauriEnv";

/**
 * Opens a directory in the OS default file manager (desktop app only).
 *
 * @param {string | null | undefined} path
 */
export async function openPathInExplorer(path) {
  if (!path?.trim()) return;
  if (!isTauri()) return;
  await openPath(path.trim());
}
