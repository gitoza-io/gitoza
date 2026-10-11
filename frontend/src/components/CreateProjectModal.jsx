import { useState } from "react";
import { FolderPlus, X } from "lucide-react";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function CreateProjectModal({ onSubmit, onClose }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isValid = name.trim().length > 0 && NAME_RE.test(name.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setLoading(true);
    setError("");
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "Failed to create project");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full min-w-0 max-w-md animate-dropdown-enter overflow-hidden rounded-ui border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-ui bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
          <div className="flex items-center gap-3">
            <FolderPlus className="h-5 w-5 text-white/90" />
            <h2 className="text-lg font-semibold text-white">New Project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-white/70 transition hover:bg-white/20 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          <div>
            <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="e.g. PaymentModule"
              className="w-full rounded border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none ring-indigo-400 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Letters, numbers, underscores, and hyphens only. Project folder under <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">.gitoza/test/cases/</code> will be created.
            </p>
            {name.trim() && !isValid && (
              <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                Invalid name — only letters, numbers, underscores (_) and hyphens (-) are allowed.
              </p>
            )}
          </div>

          {error && (
            <div className="max-h-48 overflow-y-auto break-all rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || loading}
              className="inline-flex items-center gap-2 rounded bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateProjectModal;
