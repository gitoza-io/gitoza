/**
 * User-facing message from a Tauri invoke rejection (Rust `Err(String)` is often a string, not Error).
 *
 * @param {unknown} err
 * @param {string} fallback
 * @returns {string}
 */
export function getInvokeErrorMessage(err, fallback) {
  if (err == null) return fallback;
  if (typeof err === "string" && err.trim()) return err;
  if (typeof err === "object" && err !== null && typeof err.message === "string" && err.message) {
    return err.message;
  }
  return fallback;
}
