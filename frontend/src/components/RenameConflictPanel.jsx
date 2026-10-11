import { AlertTriangle, Check, FolderInput } from "lucide-react";
import {
  CONFLICT_CHOICE_REQUIRED,
  CONFLICT_KEEP_SHARED_PATH,
  CONFLICT_KEEP_SHARED_PATH_HELPER,
  CONFLICT_KEEP_YOUR_PATH,
  CONFLICT_KEEP_YOUR_PATH_HELPER,
  CONFLICT_RENAME_HEADLINE,
  CONFLICT_RENAME_SUBCOPY,
} from "../copy/conflictResolutionCopy";
import { getConflictEntityKind, pathLeafName } from "../utils/conflictEntityLabel";

function PathChoiceCard({ selected, onClick, title, helper, path }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl border p-4 text-left transition ${
        selected
          ? "border-transparent bg-white ring-2 ring-indigo-500 dark:bg-slate-900"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600"
      }`}
    >
      {selected ? (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
          <Check className="h-3 w-3" />
        </span>
      ) : null}
      <FolderInput className="mb-2 h-5 w-5 text-indigo-600 dark:text-indigo-400" />
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
        {pathLeafName(path)}
      </p>
      <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{path}</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{helper}</p>
    </button>
  );
}

export default function RenameConflictPanel({ file, chosenPath, onChosenPathChange }) {
  const entity = getConflictEntityKind(file?.file_path);
  const yourPath = file?.your_path;
  const sharedPath = file?.shared_path;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {CONFLICT_RENAME_HEADLINE(entity)}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{CONFLICT_RENAME_SUBCOPY}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {yourPath ? (
          <PathChoiceCard
            selected={chosenPath === yourPath}
            onClick={() => onChosenPathChange(yourPath)}
            title={CONFLICT_KEEP_YOUR_PATH}
            helper={CONFLICT_KEEP_YOUR_PATH_HELPER}
            path={yourPath}
          />
        ) : null}
        {sharedPath ? (
          <PathChoiceCard
            selected={chosenPath === sharedPath}
            onClick={() => onChosenPathChange(sharedPath)}
            title={CONFLICT_KEEP_SHARED_PATH}
            helper={CONFLICT_KEEP_SHARED_PATH_HELPER}
            path={sharedPath}
          />
        ) : null}
      </div>

      {!chosenPath ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{CONFLICT_CHOICE_REQUIRED}</p>
      ) : null}
    </div>
  );
}
