import { useCallback, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { useAboutUpdates } from "../hooks/useAboutUpdates.js";
import { useAppVersion } from "../lib/appVersion.js";
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from "../constants/uiRadius.js";
import { copyToClipboard } from "../utils/copyToClipboard.js";
import { openExternalUrl } from "../utils/openExternalUrl.js";
import { THEME_IDS, THEME_LABELS } from "../utils/theme.js";

function IconButton({ title, onClick, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ui border border-border text-muted transition hover:bg-list-hover hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Consolidated General settings panel (About, Workspace, Theme).
 *
 * @param {object} props
 * @param {"light" | "dark-plus" | "high-contrast"} props.theme
 * @param {(t: "light" | "dark-plus" | "high-contrast") => void} props.onThemeChange
 * @param {string | null} [props.repoPath]
 */
export default function GeneralSettingsPanel({
  theme,
  onThemeChange,
  repoPath = null,
}) {
  const { version: appVersion, loading: appVersionLoading } = useAppVersion();
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

  const [copied, setCopied] = useState(false);

  const onCopyPath = useCallback(async () => {
    const ok = await copyToClipboard(repoPath || "");
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [repoPath]);

  const onReleaseNotes = useCallback(() => {
    openExternalUrl(releaseNotesUrl).catch(() => {});
  }, [releaseNotesUrl]);

  return (
    <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">General</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          App information, appearance, workspace location, and updates for this device.
        </p>
      </div>

      <div
        className="rounded-ui border border-slate-200 p-4 dark:border-slate-700"
        role="region"
        aria-label="About Gitoza"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Version</span>
          <span className="font-mono text-sm text-slate-500 dark:text-slate-400">
            {appVersionLoading ? "…" : appVersion ?? "—"}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Copyright © 2026 Gitoza. Licensed under Apache-2.0.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCheck}
            disabled={!isTauriDesktop || checking || installing}
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
          >
            {checking ? "Checking…" : "Check for Updates"}
          </button>
          <button type="button" onClick={onReleaseNotes} className={SETTINGS_SECONDARY_BUTTON_CLASS}>
            Release Notes
          </button>
          {result?.kind === "available" ? (
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing || checking}
              className={SETTINGS_PRIMARY_BUTTON_CLASS}
            >
              {installing ? "Installing…" : "Install Update"}
            </button>
          ) : null}
        </div>
        <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400">{statusMessage}</p>
        {installError ? (
          <p className="mt-2 rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            {installError}
          </p>
        ) : null}
      </div>

      <div className="rounded-ui border border-border bg-panel p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Appearance</h3>
          <p className="mt-1 text-sm text-muted">
            Choose how Gitoza looks on this device.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="mt-3 flex flex-col gap-1.5"
        >
          {THEME_IDS.map((id) => {
            const selected = theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={THEME_LABELS[id]}
                onClick={() => onThemeChange(id)}
                className={`flex w-full items-center gap-3 rounded-ui border px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selected
                    ? "border-primary bg-list-selected text-ink"
                    : "border-border bg-input text-muted hover:bg-list-hover hover:text-ink"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-primary" : "border-border"
                  }`}
                  aria-hidden
                >
                  {selected ? (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  ) : null}
                </span>
                <span className="font-medium">{THEME_LABELS[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5 rounded-ui border border-slate-200 p-4 dark:border-slate-700">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Workspace Path</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Local filesystem path of the active workspace.
          </p>
        </div>
        {repoPath ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              readOnly
              value={repoPath}
              className="h-8 min-w-0 flex-1 rounded-ui border border-slate-300 bg-slate-50 px-2.5 font-mono text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200"
            />
            <IconButton title="Copy path" onClick={onCopyPath} disabled={!repoPath}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              )}
            </IconButton>
          </div>
        ) : (
          <p className="rounded-ui border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100/90">
            No workspace connected.
          </p>
        )}
      </div>
    </div>
  );
}
