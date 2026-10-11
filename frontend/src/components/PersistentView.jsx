import { createContext, useContext, useEffect } from "react";
import { flexFillHidden } from "../utils/layoutClasses";

const PersistentViewActiveContext = createContext(false);

/**
 * Hook: returns whether this view is currently active (visible). Only truthy when the view is
 * the one being shown (active prop of the wrapping PersistentView is true).
 */
export function usePersistentViewActive() {
  return useContext(PersistentViewActiveContext);
}

/**
 * Hook: call load() whenever this view becomes active (including first mount when already active).
 * Use as the single place that triggers data fetch so switching back to the view shows fresh data.
 * Remove any existing useEffect(() => { load(); }, [load]) to avoid double fetch on first open.
 *
 * @param {() => void | Promise<void>} load - Function to run when the view is active (e.g. fetch list).
 */
export function useRefetchWhenActive(load) {
  const isActive = usePersistentViewActive();
  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);
}

/**
 * Keeps children mounted but hidden when not active, so view state (e.g. sort, selection) is
 * preserved when switching between menus. Use for Dashboard, Test Repository, Test Run, Review.
 * Children can use usePersistentViewActive() or useRefetchWhenActive(load) to refetch when shown.
 *
 * @param {boolean} active - When true, the view is visible; when false, hidden (display: none).
 * @param {React.ReactNode} children - The view content (always mounted when this wrapper is mounted).
 * @param {string} [className] - Layout class when visible (default: flex + flexFillHidden).
 */
function PersistentView({ active, children, className = `flex ${flexFillHidden}` }) {
  return (
    <PersistentViewActiveContext.Provider value={!!active}>
      <div
        className={active ? className : "hidden"}
        aria-hidden={!active}
      >
        {children}
      </div>
    </PersistentViewActiveContext.Provider>
  );
}

export default PersistentView;
