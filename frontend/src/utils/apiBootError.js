/**
 * User-facing message when the initial IPC bootstrap fails.
 *
 * @param {unknown} err - Tauri invoke error or unknown
 * @returns {string}
 */
export function getBootConnectionErrorMessage(err) {
  if (err == null) return "An unknown error occurred while contacting the backend.";
  if (typeof err.message === "string" && err.message) return err.message;
  if (typeof err === "string") return err;
  return "Backend communication failed.";
}
