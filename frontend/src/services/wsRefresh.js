/**
 * Refresh notifications via Tauri IPC events.
 * Replaces the former WebSocket connection to the Axum backend.
 */
import { listen } from "@tauri-apps/api/event";

const GLOBAL_KEY = "__git_test_lens_ws";

function getState() {
  if (typeof window === "undefined")
    return { unlisten: null, listeners: new Set(), started: false };
  if (!window[GLOBAL_KEY]) {
    window[GLOBAL_KEY] = { unlisten: null, listeners: new Set(), started: false };
  }
  return window[GLOBAL_KEY];
}

/** Start listening for backend refresh events (idempotent). */
export function startRefreshWebSocket() {
  const state = getState();
  if (state.started) return;
  state.started = true;

  listen("backend-refresh", (event) => {
    try {
      const msg = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
      const type = msg?.type;
      if (
        type === "REFRESH_REQUIRED" ||
        type === "RE-FETCH_TREE" ||
        type === "RE-FETCH_SUITE"
      ) {
        state.listeners.forEach((cb) => cb(type));
      }
    } catch (_) { /* malformed payload, ignore */ }
  }).then((unlisten) => {
    state.unlisten = unlisten;
  });
}

/** Subscribe to refresh events. Returns an unsubscribe function. */
export function subscribeRefresh(onRefresh) {
  const state = getState();
  state.listeners.add(onRefresh);
  return () => state.listeners.delete(onRefresh);
}
