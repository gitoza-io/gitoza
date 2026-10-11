import { openExternalUrl } from "../utils/openExternalUrl.js";
import { useAboutUpdates } from "../hooks/useAboutUpdates.js";

/**
 * Manual update check and install controls (legacy wrapper; prefer GeneralSettingsPanel).
 */
export default function AboutUpdatePanel() {
  const {
    isTauriDesktop,
    checking,
    installing,
    installError,
    result,
    statusMessage,
    releaseNotesUrl,
    handleCheck,
    handleInstall,
  } = useAboutUpdates();

  if (!isTauriDesktop) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Updates are available in the desktop app.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Updates</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">{statusMessage}</p>

      {installError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{installError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking || installing}
          className="rounded-ui border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>

        <button
          type="button"
          onClick={() => openExternalUrl(releaseNotesUrl).catch(() => {})}
          className="rounded-ui border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Release Notes
        </button>

        {result?.kind === "available" ? (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing || checking}
            className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {installing ? "Installing…" : "Install Update"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
