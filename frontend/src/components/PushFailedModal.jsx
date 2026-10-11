import { AlertTriangle } from "lucide-react";
import { getPushFailedContent, PUSH_FAILED_DISMISS } from "../copy/pushFailedCopy";

function renderStepText(text) {
  const parts = text.split(/(Sync|Confirm)/g);
  return parts.map((part, index) =>
    part === "Sync" || part === "Confirm" ? (
      <strong key={index} className="font-semibold text-slate-700 dark:text-slate-200">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

/**
 * Shown when publishing to the shared workspace fails after confirm/resolve.
 * reason: 'conflict' | 'timeout' | 'network'. Single dismiss button; user can retry afterward.
 */
export default function PushFailedModal({ open, onConfirm, reason }) {
  if (!open) return null;
  const content = getPushFailedContent(reason);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-failed-title"
      aria-describedby="push-failed-desc push-failed-steps"
    >
      <div className="w-full max-w-md animate-dropdown-enter rounded-ui border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="push-failed-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {content.title}
            </h2>
            <p id="push-failed-desc" className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              {content.lead}
            </p>
            <ol
              id="push-failed-steps"
              className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-400"
            >
              {content.steps.map((step) => (
                <li key={step}>{renderStepText(step)}</li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            {PUSH_FAILED_DISMISS}
          </button>
        </div>
      </div>
    </div>
  );
}
