import { AlertCircle } from "lucide-react";

/**
 * Full-screen state when the app cannot reach the Rust HTTP API during bootstrap.
 * Not the same as "no repository configured" — avoids showing the connect wizard with broken sub-requests.
 */
function BackendBootError({ message, onRetry }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-lg rounded-ui border border-amber-200 bg-white p-8 shadow-lg dark:border-amber-900/40 dark:bg-slate-900/80">
        <div className="mb-4 flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-8 w-8 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Cannot connect to API</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              The desktop shell loaded, but the HTTP backend did not answer. This is not the same as having no
              repository — fix connectivity first.
            </p>
          </div>
        </div>
        <div className="mb-6 rounded-ui border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
          {message}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded-ui bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export default BackendBootError;
