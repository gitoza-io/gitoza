import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { installPendingUpdate } from "../services/updater.js";
import { SUPPORT_URLS } from "../constants/supportLinks.js";
import { openExternalUrl } from "../utils/openExternalUrl.js";

function formatVersionLabel(version) {
  if (!version) return "Update";
  const trimmed = String(version).trim();
  return trimmed.startsWith("v") || trimmed.startsWith("V")
    ? trimmed
    : `V${trimmed}`;
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isReleaseNotesBodyText(value) {
  const text = String(value || "").trim();
  return text.length > 0 && !isLikelyUrl(text);
}

/**
 * Non-blocking corner toast for available updates.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.version]
 * @param {string} [props.body]
 * @param {import("@tauri-apps/plugin-updater").Update | null} [props.update]
 * @param {() => void} props.onClose
 * @param {() => void} props.onDontShowAgain
 */
export default function UpdateNotificationToast({
  open,
  version,
  body,
  update,
  onClose,
  onDontShowAgain,
}) {
  const [expanded, setExpanded] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setInstalling(false);
      setInstallError(null);
    }
  }, [open, version]);

  const handleInstall = useCallback(async () => {
    if (!update || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await installPendingUpdate(update);
    } catch (error) {
      setInstallError(error?.message || "Update installation failed.");
      setInstalling(false);
    }
  }, [update, installing]);

  const openReleaseNotes = useCallback(() => {
    openExternalUrl(SUPPORT_URLS.changelog).catch(() => {});
  }, []);

  if (!open) return null;

  const versionLabel = formatVersionLabel(version);
  const bodyText = typeof body === "string" ? body.trim() : "";
  const releaseNotesSummary = isReleaseNotesBodyText(bodyText) ? bodyText : "";

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[215] w-full max-w-[280px]">
      <div
        className="rounded-ui border border-indigo-200 bg-white shadow-lg dark:border-indigo-900/60 dark:bg-slate-900"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-1 p-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium leading-snug text-slate-900 dark:text-slate-100">
                {versionLabel} available
              </span>
              {expanded ? (
                <ChevronUp className="h-3 w-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
              )}
            </div>
            {!expanded ? (
              <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">
                Tap to view details
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Dismiss for now"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {expanded ? (
          <div className="border-t border-slate-200/80 px-3 py-2 dark:border-slate-700/80">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              {releaseNotesSummary ? (
                <p className="mb-2 leading-relaxed">{releaseNotesSummary}</p>
              ) : null}
              <button
                type="button"
                onClick={openReleaseNotes}
                className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
              >
                View Release Notes
              </button>
            </div>

            {installError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{installError}</p>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing || !update}
                className="rounded-ui bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {installing ? "Installing…" : "Install Update"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="border-t border-slate-200/60 px-2 py-1 dark:border-slate-700/60">
          <button
            type="button"
            onClick={onDontShowAgain}
            className="text-[10px] font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
          >
            Don&apos;t show again
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
