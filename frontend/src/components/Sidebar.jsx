import { CircleHelp, ClipboardCheck, File, FlaskConical, Library, Rocket, Settings, Ticket, Workflow } from "lucide-react";
import Tooltip from "./Tooltip";
import { DEFAULT_PROJECT_MODULES } from "../utils/repoModulesMirror";

function navButtonClassName(isActive) {
  const base =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-listItem";
  return isActive
    ? `${base} bg-list-selected`
    : `${base} hover:bg-list-hover`;
}

/** Ticket / release planning views (shown first). */
const planningNavItems = [
  { key: "tickets", label: "Tickets", icon: Ticket, moduleKey: "tickets" },
  { key: "releases", label: "Releases", icon: Rocket, moduleKey: "releases" },
  { key: "wiki", label: "Wiki", icon: Library, moduleKey: "wiki" },
];

/** Test repository / execution views. */
const testNavItems = [
  { key: "explorer", label: "Test Repository", icon: File, moduleKey: "test_repository" },
  { key: "testrun", label: "Test Run", icon: FlaskConical, moduleKey: "test_run" },
  { key: "automation", label: "Test Automation", icon: Workflow, moduleKey: "automation" },
  { key: "review", label: "Review", icon: ClipboardCheck, moduleKey: null },
];

function NavIconButtons({ items, activeView, onChangeView }) {
  return items.map((item) => {
    const Icon = item.icon;
    const isActive = activeView === item.key;
    return (
      <Tooltip key={item.key} label={item.label} placement="right">
        <button
          type="button"
          onClick={() => onChangeView(item.key)}
          className={navButtonClassName(isActive)}
          aria-current={isActive ? "page" : undefined}
          aria-label={item.label}
        >
          <Icon
            className={`h-5 w-5 ${isActive ? "text-ink dark:text-slate-100" : "text-muted dark:text-slate-400"}`}
          />
        </button>
      </Tooltip>
    );
  });
}

function Sidebar({
  activeView,
  onChangeView,
  reviewEnabled = true,
  modules = DEFAULT_PROJECT_MODULES,
  updateBanner = null,
  onOpenSettings,
  onOpenHelp,
  settingsActive = false,
  navigationLocked = false,
}) {
  const mods = modules ?? DEFAULT_PROJECT_MODULES;
  const planningItems = planningNavItems.filter((item) => mods[item.moduleKey] !== false);
  const testItems = testNavItems.filter((item) => {
    if (item.key === "review") return reviewEnabled;
    return mods[item.moduleKey] !== false;
  });
  const showSeparator = planningItems.length > 0 && testItems.length > 0;

  return (
    <aside className="relative flex h-full w-10 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-border bg-panel py-3">
      {/* ---- Logo slot (reserved for company logo) ---- */}
      <div className="mb-6 flex min-h-[2.5rem] items-center justify-center" aria-hidden="true">
        {/* Placeholder for future logo */}
      </div>

      {updateBanner}

      <nav className="flex flex-col items-center gap-0.5" aria-label="Main navigation">
        {planningItems.length > 0 ? (
          <NavIconButtons items={planningItems} activeView={activeView} onChangeView={onChangeView} />
        ) : null}
        {showSeparator ? (
          <div
            className="my-1.5 h-px w-5 bg-border"
            role="separator"
            aria-hidden="true"
          />
        ) : null}
        {testItems.length > 0 ? (
          <NavIconButtons items={testItems} activeView={activeView} onChangeView={onChangeView} />
        ) : null}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-0.5 pb-1" aria-label="App actions">
        <Tooltip label="Settings" placement="right">
          <button
            type="button"
            onClick={onOpenSettings}
            disabled={navigationLocked}
            className={navButtonClassName(settingsActive)}
            aria-label="Settings"
            aria-current={settingsActive ? "page" : undefined}
          >
            <Settings
              className={`h-5 w-5 ${settingsActive ? "text-ink dark:text-slate-100" : "text-muted dark:text-slate-400"}`}
            />
          </button>
        </Tooltip>
        <Tooltip label="Help" placement="right">
          <button
            type="button"
            onClick={onOpenHelp}
            disabled={navigationLocked}
            className={navButtonClassName(false)}
            aria-label="Help"
          >
            <CircleHelp className="h-5 w-5 text-muted dark:text-slate-400" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

export default Sidebar;
