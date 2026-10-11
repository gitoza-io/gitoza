import { RefreshCw, Save, Upload } from "lucide-react";

import { TOOLBAR_BTN_BASE } from "../constants/toolbarStyles";
import Tooltip from "./Tooltip";

/**
 * Compact workflow status indicator + Sync/Save button for the sidebar title row.
 * Green dot = baseline, yellow dot = editing (local changes).
 * Remote workspaces show Sync when drafting; playground shows Save (local commit only).
 */
function WorkflowStatusAndSync({
  workflowState = "baseline",
  workspaceKind = "remote_git",
  onSync,
  syncLoading = false,
  syncError = null,
  onIndexExternal = null,
  isIndexing = false,
  readOnly = false,
}) {
  const isPlayground = workspaceKind === "playground";
  const isDrafting = workflowState === "drafting";
  const statusLabel = isDrafting
    ? isPlayground
      ? "Local playground — unsaved changes on this device"
      : "Editing — local changes not yet pushed"
    : isPlayground
      ? "Playground — saved locally"
      : "Baseline — synced with remote";

  const syncButtonLabel = isPlayground
    ? syncLoading
      ? "Saving…"
      : "Save"
    : syncLoading
      ? "Syncing…"
      : "Sync";

  const syncTooltip = isPlayground
    ? "Save changes locally (connect a repository to sync with others)"
    : "Push local changes to remote";

  return (
    <div className="flex items-center gap-2">
      <Tooltip label={statusLabel} placement="bottom">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
            isDrafting
              ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]"
              : "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]"
          }`}
          aria-label={isDrafting ? "Editing" : "Baseline"}
        />
      </Tooltip>
      {isDrafting && onSync && !readOnly && (
        <Tooltip label={syncTooltip} placement="bottom">
          <button
            type="button"
            onClick={onSync}
            disabled={syncLoading}
            className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-500 disabled:opacity-60"
            aria-label={syncTooltip}
          >
            {isPlayground ? (
              <Save className="h-3 w-3" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {syncButtonLabel}
          </button>
        </Tooltip>
      )}
      {typeof onIndexExternal === "function" && (
        <Tooltip
          label="Refresh workspace index from external file changes (choose incremental or full)."
          placement="bottom"
        >
          <button
            type="button"
            onClick={onIndexExternal}
            disabled={isIndexing || syncLoading}
            className={TOOLBAR_BTN_BASE}
            aria-label="Refresh index from external file changes"
          >
            <RefreshCw
              className={`h-4 w-4 ${isIndexing ? "animate-spin" : ""}`}
            />
          </button>
        </Tooltip>
      )}
      {syncError && (
        <span
          className="max-w-[10rem] truncate text-xs text-red-600 dark:text-red-400"
          title={syncError}
        >
          {syncError}
        </span>
      )}
    </div>
  );
}

export default WorkflowStatusAndSync;
