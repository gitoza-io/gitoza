import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../utils/tauriEnv";
import { isMacTauri } from "../utils/platform";

export function useWindowDragHandler() {
  return useCallback((e) => {
    if (e.button !== 0) return;
    if (!isTauri()) return;
    e.preventDefault();
    getCurrentWindow()
      .startDragging()
      .catch(() => {});
  }, []);
}

export function WindowDragRegion({ className = "" }) {
  const handleDragMouseDown = useWindowDragHandler();

  return (
    <div
      role="presentation"
      className={`app-titlebar-drag min-h-0 min-w-0 flex-1 cursor-default ${className}`.trim()}
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
    />
  );
}

/** macOS overlay title bar row (traffic-light inset + drag region). */
export function getOnboardingTitleBarClass() {
  return "app-titlebar app-titlebar--macos flex h-10 shrink-0 items-stretch gap-2 border-b border-slate-200/80 bg-white/90 pl-[4.75rem] pr-2 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/90";
}

/**
 * macOS-only overlay spacer for onboarding and main shell.
 * Reserves space for traffic lights and provides a drag region.
 * Win/Linux use native title bars; browser dev renders nothing.
 */
function FramelessWindowChrome() {
  if (!isMacTauri()) return null;

  return (
    <header className={getOnboardingTitleBarClass()}>
      <WindowDragRegion />
    </header>
  );
}

export default FramelessWindowChrome;
