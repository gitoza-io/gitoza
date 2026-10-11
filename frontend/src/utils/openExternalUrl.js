import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "../utils/tauriEnv";

/**
 * Opens an external URL or mailto link using the OS default application per scheme
 * (browser for http(s), mail client for mailto). In Tauri, uses the Opener plugin.
 * Falls back to standard browser behavior when not running in Tauri.
 *
 * @param {string} url
 */
export async function openExternalUrl(url) {
  const trimmed = url.trim();
  if (isTauri()) {
    await openUrl(trimmed);
    return;
  }
  if (trimmed.startsWith("mailto:")) {
    window.location.href = trimmed;
    return;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
}
