import { useEffect } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import {
  AUTOMATION_SYNC_ERROR_MS,
  AUTOMATION_SYNC_SUCCESS_MS,
} from "../utils/formatAutomationSyncFeedback";

const TONE_CLASS = {
  success: "text-emerald-700 dark:text-emerald-400",
  neutral: "text-slate-500 dark:text-slate-400",
  error: "text-red-600 dark:text-red-400",
};

/**
 * Ephemeral inline status shown below the Load from storage control in Test Automation.
 *
 * @param {{ feedback: { tone: "success" | "neutral" | "error"; text: string } | null; onDismiss: () => void }} props
 */
function AutomationSyncStatusLine({ feedback, onDismiss }) {
  useEffect(() => {
    if (!feedback) return undefined;
    const durationMs =
      feedback.tone === "error" ? AUTOMATION_SYNC_ERROR_MS : AUTOMATION_SYNC_SUCCESS_MS;
    const timer = window.setTimeout(() => onDismiss?.(), durationMs);
    return () => window.clearTimeout(timer);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  const Icon = feedback.tone === "error" ? AlertCircle : feedback.tone === "success" ? Check : null;

  return (
    <div
      className={`flex min-w-0 items-start gap-1 px-1 pb-1 pt-0.5 text-xs leading-snug transition-opacity duration-200 ${TONE_CLASS[feedback.tone] ?? TONE_CLASS.neutral}`}
      role="status"
      aria-live="polite"
    >
      {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 truncate">{feedback.text}</span>
      {feedback.tone === "error" ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-current opacity-70 transition hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export default AutomationSyncStatusLine;
