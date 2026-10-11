/**
 * User-facing copy for automation storage sync feedback.
 *
 * @param {{ updated?: number; discovered?: number; removed?: number }} result
 * @returns {{ tone: "success" | "neutral"; text: string }}
 */
export function formatAutomationSyncFeedback(result) {
  const updated = result?.updated ?? 0;
  const discovered = result?.discovered ?? 0;
  const removed = result?.removed ?? 0;

  if (discovered === 0) {
    return { tone: "neutral", text: "No results on remote yet" };
  }

  if (updated > 0) {
    const runLabel = updated === 1 ? "run" : "runs";
    let text = `Synced · ${updated} ${runLabel} indexed`;
    if (removed > 0) {
      text += ` · ${removed} removed`;
    }
    return { tone: "success", text };
  }

  let text = `Up to date · ${discovered} on remote`;
  if (removed > 0) {
    text += ` · ${removed} removed`;
  }
  return { tone: "success", text };
}

export const AUTOMATION_SYNC_SUCCESS_MS = 1800;
export const AUTOMATION_SYNC_ERROR_MS = 4000;
