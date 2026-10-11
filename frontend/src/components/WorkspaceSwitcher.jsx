import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteRepo } from "../services/api";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";

/**
 * Compact workspace switcher for sidebar footer.
 * Trigger: workspace name + up/down chevron (no avatar).
 * Dropdown: React Portal, full sidebar width, opens upward above the trigger.
 */
function WorkspaceSwitcher({
  reposList = [],
  activeRepoSlug,
  onSwitchRepo,
  onAddWorkspace,
  onAfterDeleteRepo,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnimate, setMenuAnimate] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const [slugToDelete, setSlugToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const triggerRef = useRef(null);

  const activeRepo = reposList.find((r) => r.slug === activeRepoSlug);
  const displayName = activeRepo?.display_name || (reposList.length === 0 && onAddWorkspace ? "Add workspace" : "Workspace");
  const showSwitcher = reposList.length >= 1 || onAddWorkspace;

  useEffect(() => {
    if (menuOpen) {
      if (triggerRef.current) {
        const footer = triggerRef.current.closest("[data-sidebar-footer]");
        const aside = triggerRef.current.closest("aside");
        const anchor = footer || aside;
        if (anchor) {
          const rect = anchor.getBoundingClientRect();
          setMenuStyle({
            position: "fixed",
            left: rect.left,
            width: rect.width,
            bottom: window.innerHeight - rect.top,
          });
        }
      }
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setMenuAnimate(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setMenuAnimate(false);
    setMenuStyle(null);
  }, [menuOpen]);

  const handleConfirmDelete = async () => {
    if (!slugToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteRepo(slugToDelete);
      onAfterDeleteRepo?.(slugToDelete);
      setSlugToDelete(null);
      setMenuOpen(false);
    } catch (err) {
      setDeleteError(err?.message || "Failed to delete workspace.");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!showSwitcher) return null;

  const dropdown = menuOpen && menuStyle ? createPortal(
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
      <div
        className={`fixed z-50 max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-ui border border-slate-200 bg-white py-0 shadow-xl dark:border-slate-700 dark:bg-slate-800 ${
          menuAnimate ? "animate-dropdown-enter opacity-100" : "scale-95 opacity-0"
        } origin-bottom-left`}
        style={menuStyle}
        role="listbox"
      >
        {reposList.map((r) => {
          const isActive = r.slug === activeRepoSlug;
          return (
            <div
              key={r.slug}
              role="option"
              aria-selected={isActive}
              className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm transition ${
                isActive
                  ? "bg-indigo-500/10 font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/80"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 truncate"
                  onClick={() => {
                    onSwitchRepo?.(r.slug);
                    setMenuOpen(false);
                  }}
                >
                  <span className="truncate">{r.display_name}</span>
                  {r.workspace_kind === "playground" && (
                    <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-600 dark:text-slate-300">
                      Local
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 items-center gap-1.5">
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSlugToDelete(r.slug);
                      setDeleteError(null);
                    }}
                    className="rounded-none p-0.5 text-slate-400 hover:bg-slate-200 hover:text-red-600 dark:hover:bg-slate-600 dark:hover:text-red-400"
                    title="Delete workspace"
                    aria-label={`Delete ${r.display_name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            </div>
          );
        })}
        {onAddWorkspace && (
          <>
            <div className="border-t border-slate-200 dark:border-slate-600" />
            <button
              type="button"
              onClick={() => {
                onAddWorkspace?.();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 py-1.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/80"
            >
              <span className="flex items-center gap-2 px-3">
                <Plus className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Add Workspace</span>
              </span>
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-none px-1 py-1.5 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800/80"
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        aria-label="Switch workspace"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
          {displayName}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      </button>

      {dropdown}

      {slugToDelete && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-workspace-title"
        >
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => {
              if (!deleteLoading) setSlugToDelete(null);
              setDeleteError(null);
            }}
          />
          <div className="relative w-full max-w-md rounded-ui bg-white p-6 shadow-xl dark:bg-slate-800">
            <h2 id="delete-workspace-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Delete workspace
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Permanently delete this workspace? The cloned repository and all local index data will be removed. This
              cannot be undone.
            </p>
            {deleteError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{deleteError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => {
                  setSlugToDelete(null);
                  setDeleteError(null);
                }}
                className="rounded-ui px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleConfirmDelete}
                className="rounded-ui bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
              >
                {deleteLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default WorkspaceSwitcher;
