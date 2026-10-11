import { isTauri } from "../utils/tauriEnv";

/** True when running in Tauri on macOS (overlay title bar + traffic lights). */
export function isMacTauri() {
  if (!isTauri()) return false;
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}
