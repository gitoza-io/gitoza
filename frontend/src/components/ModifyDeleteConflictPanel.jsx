import { AlertTriangle, Check, Copy, FileCheck } from "lucide-react";
import {
  CONFLICT_DISK_RESOLUTION_HINT,
  CONFLICT_KEEP_BOTH_ENTITY,
  CONFLICT_KEEP_BOTH_ENTITY_HELPER,
  CONFLICT_KEEP_MINE_ENTITY,
  CONFLICT_KEEP_MINE_ENTITY_HELPER,
  CONFLICT_KEEP_THEIRS_ENTITY,
  CONFLICT_KEEP_THEIRS_ENTITY_HELPER,
  CONFLICT_MODIFY_DELETE_HEADLINE,
  CONFLICT_MODIFY_DELETE_MOVE_SUBCOPY,
  CONFLICT_MODIFY_DELETE_SUBCOPY,
} from "../copy/conflictResolutionCopy";
import { getConflictEntityKind } from "../utils/conflictEntityLabel";

function ChoiceCard({ selected, onClick, icon: Icon, title, helper, accent = "indigo" }) {
  const accentRing = accent === "rose" ? "ring-rose-500" : "ring-indigo-500";
  const accentIcon =
    accent === "rose"
      ? "text-rose-600 dark:text-rose-400"
      : "text-indigo-600 dark:text-indigo-400";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl border p-4 text-left transition ${
        selected
          ? `border-transparent bg-white ring-2 ${accentRing} dark:bg-slate-900`
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600"
      }`}
    >
      {selected ? (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
          <Check className="h-3 w-3" />
        </span>
      ) : null}
      <Icon className={`mb-2 h-5 w-5 ${accentIcon}`} />
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</p>
    </button>
  );
}

export default function ModifyDeleteConflictPanel({ file, action, onActionChange }) {
  const entity = getConflictEntityKind(file?.file_path);
  const hasCompanionPath = Boolean(file?.shared_path);
  const subcopy = hasCompanionPath
    ? CONFLICT_MODIFY_DELETE_MOVE_SUBCOPY
    : CONFLICT_MODIFY_DELETE_SUBCOPY;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {CONFLICT_MODIFY_DELETE_HEADLINE(entity, Boolean(file?.shared_deleted))}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subcopy}</p>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${hasCompanionPath ? "" : "md:grid-cols-2"}`}>
        <ChoiceCard
          selected={action === "keep_mine"}
          onClick={() => onActionChange("keep_mine")}
          icon={FileCheck}
          title={CONFLICT_KEEP_MINE_ENTITY(entity, hasCompanionPath)}
          helper={CONFLICT_KEEP_MINE_ENTITY_HELPER(hasCompanionPath)}
        />
        {hasCompanionPath ? (
          <ChoiceCard
            selected={action === "keep_both"}
            onClick={() => onActionChange("keep_both")}
            icon={Copy}
            title={CONFLICT_KEEP_BOTH_ENTITY(entity)}
            helper={CONFLICT_KEEP_BOTH_ENTITY_HELPER}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onActionChange("keep_theirs")}
        className={`text-xs underline-offset-2 hover:underline ${
          action === "keep_theirs"
            ? "font-medium text-indigo-600 dark:text-indigo-400"
            : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {CONFLICT_KEEP_THEIRS_ENTITY(entity, hasCompanionPath)}
      </button>
      {action === "keep_theirs" ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {CONFLICT_KEEP_THEIRS_ENTITY_HELPER(hasCompanionPath)}
        </p>
      ) : null}

      <p className="text-xs text-slate-500 dark:text-slate-400">{CONFLICT_DISK_RESOLUTION_HINT}</p>
    </div>
  );
}
