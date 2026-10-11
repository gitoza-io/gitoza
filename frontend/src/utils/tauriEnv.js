/**
 * Detects the Tauri v2 webview runtime (IPC available).
 * @returns {boolean}
 */
export function isTauri() {
  return (
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__")
  );
}
