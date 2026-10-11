import { Loader2 } from "lucide-react";
import { flexFillHidden } from "../utils/layoutClasses";

const WRAPPER_CLASS = `flex ${flexFillHidden} flex-col items-center justify-center gap-2 p-4`;
const SPINNER_CLASS = "h-8 w-8 animate-spin text-slate-400";
const MESSAGE_CLASS = "text-sm text-slate-500 dark:text-slate-400";

/**
 * Unified loading state for the right-hand detail panel (centered spinner + message).
 * Use when detail content is being fetched (e.g. run detail, case detail).
 *
 * @param {{ message?: string }} [props] - Optional message below the spinner (default "Loading…").
 */
export default function DetailPanelLoading({ message = "Loading…" }) {
  return (
    <div className={WRAPPER_CLASS}>
      <Loader2 className={SPINNER_CLASS} aria-hidden="true" />
      {message && <p className={MESSAGE_CLASS}>{message}</p>}
    </div>
  );
}
