import { useEffect, useRef, useState } from "react";
import {
  ClipboardCheck,
  File,
  FlaskConical,
  FolderCog,
  HardDrive,
  Library,
  Rocket,
  Settings,
  Ticket,
  User,
  Workflow,
} from "lucide-react";
import TreeContentLayout from "../components/TreeContentLayout";
import { sidebarListItemClassName } from "../components/SidebarSection";
import GeneralSettingsPanel from "../components/GeneralSettingsPanel";
import StorageSyncSettingsPanel from "../components/StorageSyncSettingsPanel";
import GitProfileSettingsPanel from "../components/GitProfileSettingsPanel";
import {
  DEFAULT_PROJECT_MODULES,
  featureFlagsEqual,
  normalizeProjectModules,
  normalizeRepoFeatureFlags,
} from "../utils/repoModulesMirror";

const SECTIONS = [
  { id: "general", label: "General", icon: Settings },
  { id: "profile", label: "Profile", icon: User },
  { id: "project", label: "Project Settings", icon: FolderCog },
  { id: "storage-sync", label: "Storage Sync", icon: HardDrive },
];

/** Same icons/order as the main sidebar (planning, then test + review). */
const MENU_TOGGLES = [
  { id: "tickets", kind: "module", moduleKey: "tickets", label: "Tickets", icon: Ticket },
  { id: "releases", kind: "module", moduleKey: "releases", label: "Releases", icon: Rocket },
  { id: "wiki", kind: "module", moduleKey: "wiki", label: "Wiki", icon: Library },
  {
    id: "test_repository",
    kind: "module",
    moduleKey: "test_repository",
    label: "Test Repository",
    icon: File,
  },
  { id: "test_run", kind: "module", moduleKey: "test_run", label: "Test Run", icon: FlaskConical },
  {
    id: "automation",
    kind: "module",
    moduleKey: "automation",
    label: "Test Automation",
    icon: Workflow,
  },
  { id: "review", kind: "review", label: "Review", icon: ClipboardCheck },
];

const PLANNING_IDS = new Set(["tickets", "releases", "wiki"]);

function flagsFromProps(enableReviewSystem, modules) {
  return normalizeRepoFeatureFlags({
    enable_review_system: enableReviewSystem,
    modules,
  });
}

/**
 * Settings: left navigation + detail panels.
 *
 * @param {object} props
 * @param {"light" | "dark-plus" | "high-contrast"} props.theme
 * @param {(t: "light" | "dark-plus" | "high-contrast") => void} props.onThemeChange
 * @param {React.ReactNode} [props.sidebarFooter]
 * @param {React.ReactNode} [props.sidebarTitleRight]
 * @param {string | null} [props.repoPath] - Local filesystem path of the active workspace (from repo status).
 * @param {string} [props.initialSection] - First selected settings section (default "general").
 * @param {boolean} [props.enableReviewSystem] - From `.gitoza/config.json` (default true).
 * @param {object} [props.modules] - Module visibility flags from project config.
 * @param {(next: { enable_review_system: boolean, modules: object }) => Promise<void>} [props.onFeatureFlagsChange]
 * @param {string | null} [props.repoSlug]
 * @param {object | null} [props.projectSyncConfig]
 * @param {(payload: object) => Promise<void>} [props.onProjectSyncConfigSave]
 * @param {(config: object) => void} [props.onProjectSyncConfigUpdated]
 * @param {number} [props.storageSyncSectionFocusKey]
 * @param {boolean} [props.readOnly] - No workspace: disable project toggles.
 * @param {() => void} [props.onProfileSaved] - Called after global Git profile is saved.
 */
function SettingsPage({
  theme,
  onThemeChange,
  sidebarFooter = null,
  sidebarTitleRight = null,
  repoPath = null,
  repoSlug = null,
  initialSection = "general",
  storageSyncSectionFocusKey = 0,
  enableReviewSystem = true,
  modules = DEFAULT_PROJECT_MODULES,
  onFeatureFlagsChange,
  projectSyncConfig = null,
  onProjectSyncConfigSave,
  onProjectSyncConfigUpdated,
  readOnly = false,
  onProfileSaved,
}) {
  const [section, setSection] = useState(initialSection);
  const appliedStorageSyncFocusKeyRef = useRef(0);
  const [configError, setConfigError] = useState(null);
  const [draftFlags, setDraftFlags] = useState(() =>
    flagsFromProps(enableReviewSystem, modules),
  );
  const draftRef = useRef(draftFlags);
  draftRef.current = draftFlags;
  /** In-flight save guard without React state (avoids disabled/opacity re-render flash). */
  const savingRef = useRef(false);

  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (storageSyncSectionFocusKey > appliedStorageSyncFocusKeyRef.current) {
      appliedStorageSyncFocusKeyRef.current = storageSyncSectionFocusKey;
      setSection("storage-sync");
    }
  }, [storageSyncSectionFocusKey]);

  // Sync from parent when props change; skip while a local save is in flight.
  useEffect(() => {
    if (savingRef.current) return;
    const incoming = flagsFromProps(enableReviewSystem, modules);
    setDraftFlags((prev) => (featureFlagsEqual(prev, incoming) ? prev : incoming));
  }, [enableReviewSystem, modules]);

  const nav = (
    <nav className="flex flex-col gap-0.5 pl-2 pr-1" aria-label="Settings sections">
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const active = section === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={sidebarListItemClassName(active)}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );

  const togglesLocked = readOnly || !repoPath || !onFeatureFlagsChange;

  const toggleMenu = async (item, on) => {
    if (togglesLocked || savingRef.current) return;
    const prev = draftRef.current;
    const next =
      item.kind === "review"
        ? normalizeRepoFeatureFlags({
            enable_review_system: on,
            modules: prev.modules,
          })
        : normalizeRepoFeatureFlags({
            enable_review_system: prev.enable_review_system,
            modules: { ...prev.modules, [item.moduleKey]: on },
          });
    setConfigError(null);
    setDraftFlags(next);
    savingRef.current = true;
    try {
      await onFeatureFlagsChange(next);
    } catch (err) {
      setDraftFlags(prev);
      setConfigError(err?.message || "Failed to save project settings.");
    } finally {
      savingRef.current = false;
    }
  };

  let panel = null;
  if (section === "general") {
    panel = (
      <GeneralSettingsPanel
        theme={theme}
        onThemeChange={onThemeChange}
        repoPath={repoPath}
      />
    );
  } else if (section === "profile") {
    panel = (
      <GitProfileSettingsPanel
        repoSlug={repoSlug}
        readOnly={readOnly}
        onProfileSaved={onProfileSaved}
      />
    );
  } else if (section === "project") {
    const planningMenus = MENU_TOGGLES.filter((item) => PLANNING_IDS.has(item.id));
    const testMenus = MENU_TOGGLES.filter((item) => !PLANNING_IDS.has(item.id));
    const currentModules = normalizeProjectModules(draftFlags.modules);

    const renderMenuRow = (item) => {
      const Icon = item.icon;
      const checked =
        item.kind === "review"
          ? draftFlags.enable_review_system
          : currentModules[item.moduleKey] !== false;
      return (
        <label
          key={item.id}
          className={`flex items-center gap-3 px-3 py-3 ${
            togglesLocked ? "cursor-default" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
          }`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 disabled:opacity-100"
            checked={checked}
            disabled={togglesLocked}
            onChange={(e) => {
              void toggleMenu(item, e.target.checked);
            }}
          />
          <Icon className="h-5 w-5 shrink-0 text-muted dark:text-slate-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-900 dark:text-slate-100">
            {item.label}
          </span>
        </label>
      );
    };

    panel = (
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Project Settings</h2>
          <p className="mt-2 leading-relaxed">
            Team-wide options stored in{" "}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">.gitoza/config.json</code>{" "}
            in your Git repository. Use <strong>Confirm Changes</strong> to commit so everyone gets the same setting.
          </p>
        </div>
        {!repoPath ? (
          <p className="rounded-ui border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100/90">
            Connect a workspace to change project settings.
          </p>
        ) : (
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Visible menus</h3>
              <p className="mt-1 text-xs text-muted dark:text-slate-400">
                Match the sidebar to what this project uses. Turning Review off also auto-approves new cases and runs.
              </p>
            </div>
            <div className="overflow-hidden rounded-ui border border-slate-200 dark:border-slate-700">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {planningMenus.map(renderMenuRow)}
              </div>
              <div
                className="border-t border-slate-200 dark:border-slate-700"
                role="separator"
                aria-hidden="true"
              />
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {testMenus.map(renderMenuRow)}
              </div>
            </div>
          </div>
        )}
        {configError ? (
          <p className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            {configError}
          </p>
        ) : null}
      </div>
    );
  } else if (section === "storage-sync") {
    panel = (
      <StorageSyncSettingsPanel
        key={repoSlug ?? "no-repo"}
        repoSlug={repoSlug}
        readOnly={readOnly}
        config={projectSyncConfig}
        onSave={onProjectSyncConfigSave}
        onConfigUpdated={onProjectSyncConfigUpdated}
      />
    );
  }

  return (
    <TreeContentLayout
      sidebarTitle="Settings"
      sidebarTitleRight={sidebarTitleRight}
      sidebarContent={nav}
      sidebarFooter={sidebarFooter}
    >
      <div className="main-content-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-white p-4 dark:bg-slate-950">
        {panel}
      </div>
    </TreeContentLayout>
  );
}

export default SettingsPage;
