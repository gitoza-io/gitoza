import { Clock3, FolderOpen, UserRound } from "lucide-react";

/**
 * Project card: folder-level aggregate. Displays suite_count, total_test_cases,
 * aggregated priority bar, and latest_activity. Click navigates to Test Repository and expands the project folder in the tree.
 */
function ProjectCard({ project, onClick }) {
  const suiteCount = project.suite_count ?? 0;
  const total = project.total_test_cases ?? 0;
  const agg = project.aggregated_priority ?? project.project_priority_distribution ?? {};
  const high = agg.High ?? 0;
  const medium = agg.Medium ?? 0;
  const low = agg.Low ?? 0;
  const automated = project.automated_count ?? 0;
  const manual = Math.max(0, total - automated);
  const hasStats = total > 0;

  const highPct = total ? (high / total) * 100 : 0;
  const mediumPct = total ? (medium / total) * 100 : 0;
  const lowPct = total ? (low / total) * 100 : 0;
  const automatedPct = total ? (automated / total) * 100 : 0;
  const manualPct = total ? (manual / total) * 100 : 0;

  const activity = project.latest_activity ?? project.last_activity;
  const activityTime = activity?.timestamp
    ? new Date(activity.timestamp).toLocaleString()
    : "No activity";
  const activityAuthor = activity?.author ?? "—";

  const displayName = (project.project_name ?? "").replace(/_/g, " ");
  const subtitle = `${suiteCount} Test Suite${suiteCount !== 1 ? "s" : ""} · ${total} Total Test Cases`;

  return (
    <button
      type="button"
      onClick={() => onClick(project.project_path)}
      className="w-full rounded-ui border border-slate-200 bg-white p-4 text-left transition hover:border-blue-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-blue-500/50"
    >
      <div className="flex items-start gap-3">
        <div className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
          <FolderOpen className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{displayName}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>

      {hasStats && (
        <div className="mt-3 space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="flex h-full w-full">
              <div className="bg-red-500" style={{ width: `${highPct}%` }} title="High" />
              <div className="bg-orange-500" style={{ width: `${mediumPct}%` }} title="Medium" />
              <div className="bg-blue-500" style={{ width: `${lowPct}%` }} title="Low" />
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" title="Automation coverage">
            <div className="flex h-full w-full">
              <div className="bg-indigo-500" style={{ width: `${automatedPct}%` }} title="Automated" />
              <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${manualPct}%` }} title="Manual" />
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <div className="flex items-center gap-1 truncate">
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{activityAuthor}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{activityTime}</span>
        </div>
      </div>
    </button>
  );
}

export default ProjectCard;
