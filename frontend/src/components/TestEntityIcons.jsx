import { Bug, BookOpen, CheckSquare, File, FlaskConical, Library, Zap, Workflow } from "lucide-react";

/** Round wrapper: soft tint so circle stays visible on selected row without looking harsh. */
const ROUND_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50";

const PIPELINE_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50";

const BUG_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/50";

const STORY_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/50";

const TASK_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800";

const SPIKE_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50";

const WIKI_WRAPPER_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50";

/** Icon size and color inside the round wrapper (Test Run). */
const TEST_RUN_ICON_CLASS =
  "h-4 w-4 text-indigo-500 dark:text-indigo-400";

/** Icon size and color inside the round wrapper (CI pipeline). */
const PIPELINE_ICON_CLASS =
  "h-4 w-4 text-sky-600 dark:text-sky-400";

/** Icon size and color inside the round wrapper (Test Case). */
const TEST_CASE_ICON_CLASS =
  "h-4 w-4 text-emerald-600 dark:text-emerald-400";

const BUG_ICON_CLASS = "h-4 w-4 text-rose-600 dark:text-rose-400";
const STORY_ICON_CLASS = "h-4 w-4 text-violet-600 dark:text-violet-400";
const TASK_ICON_CLASS = "h-4 w-4 text-slate-600 dark:text-slate-300";
const SPIKE_ICON_CLASS = "h-4 w-4 text-amber-600 dark:text-amber-400";
const WIKI_ICON_CLASS = "h-4 w-4 text-teal-600 dark:text-teal-400";

/**
 * When className is passed, use it on the inner icon so parent can control color/size (e.g. nav active state).
 */
function iconClass(defaultClass, className) {
  if (className) return `h-4 w-4 ${className}`;
  return defaultClass;
}

/**
 * Icon for "Test Run" (batch of cases). Flask/reagent bottle, common in QA for test runs.
 * Use in Sidebar nav, RunListTree run row, Dashboard/Review empty states, etc.
 */
export function TestRunIcon({ className, ...props }) {
  return (
    <span className={ROUND_WRAPPER_CLASS} aria-hidden>
      <FlaskConical
        className={iconClass(TEST_RUN_ICON_CLASS, className)}
        {...props}
      />
    </span>
  );
}

/**
 * Icon for CI / test automation pipeline (folder of runs).
 */
export function PipelineIcon({ className, ...props }) {
  return (
    <span className={PIPELINE_WRAPPER_CLASS} aria-hidden>
      <Workflow
        className={iconClass(PIPELINE_ICON_CLASS, className)}
        {...props}
      />
    </span>
  );
}

/**
 * Icon for "Test Case" (single case). Simple doc icon in a round circle.
 * Use in RunListTree case row, CaseTree, RunCaseTree, Review case tab, etc.
 */
export function TestCaseIcon({ className, ...props }) {
  return (
    <span className={ROUND_WRAPPER_CLASS} aria-hidden>
      <File
        className={iconClass(TEST_CASE_ICON_CLASS, className)}
        {...props}
      />
    </span>
  );
}

/**
 * Icon for a wiki page (distinct from test-case File and story BookOpen).
 */
export function WikiPageIcon({ className, ...props }) {
  return (
    <span className={WIKI_WRAPPER_CLASS} aria-hidden>
      <Library className={iconClass(WIKI_ICON_CLASS, className)} {...props} />
    </span>
  );
}

/**
 * Icon for a ticket by type: bug | story | task | spike (default task).
 * @param {{ type?: string | null, className?: string }} props
 */
export function TicketTypeIcon({ type = "task", className, ...props }) {
  const kind = String(type || "task").trim().toLowerCase();
  if (kind === "bug") {
    return (
      <span className={BUG_WRAPPER_CLASS} aria-hidden>
        <Bug className={iconClass(BUG_ICON_CLASS, className)} {...props} />
      </span>
    );
  }
  if (kind === "story") {
    return (
      <span className={STORY_WRAPPER_CLASS} aria-hidden>
        <BookOpen className={iconClass(STORY_ICON_CLASS, className)} {...props} />
      </span>
    );
  }
  if (kind === "spike") {
    return (
      <span className={SPIKE_WRAPPER_CLASS} aria-hidden>
        <Zap className={iconClass(SPIKE_ICON_CLASS, className)} {...props} />
      </span>
    );
  }
  return (
    <span className={TASK_WRAPPER_CLASS} aria-hidden>
      <CheckSquare className={iconClass(TASK_ICON_CLASS, className)} {...props} />
    </span>
  );
}

export {
  TEST_RUN_ICON_CLASS,
  TEST_CASE_ICON_CLASS,
  PIPELINE_ICON_CLASS,
  WIKI_ICON_CLASS,
};
