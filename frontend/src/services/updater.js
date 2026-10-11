/**
 * Update checks via @tauri-apps/plugin-updater.
 * Runs once on launch (corner toast when available); manual check in Settings → General.
 */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getAppVersion } from "../lib/appVersion.js";
import { isTauri } from "../utils/tauriEnv.js";
import { isUpdateNoticeDismissed } from "../utils/updateNotificationPrefs.js";

const GLOBAL_KEY = "__git_test_lens_updater";
const CHECK_TIMEOUT_MS = 30000;

/** Local `tauri.conf.json` placeholder (`0.0.0-dev`); skip launch toast against production. */
function isLocalDevAppVersion(version) {
  return typeof version === "string" && /^0\.0\.0\b/.test(version);
}

function getState() {
  if (typeof window === "undefined") {
    return {
      started: false,
      listeners: new Set(),
      lastResult: null,
    };
  }
  if (!window[GLOBAL_KEY]) {
    window[GLOBAL_KEY] = {
      started: false,
      listeners: new Set(),
      lastResult: null,
    };
  }
  return window[GLOBAL_KEY];
}

function notifyListeners(event) {
  const state = getState();
  state.listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (_) {
      /* ignore subscriber errors */
    }
  });
}

/**
 * @typedef {{ kind: 'none' }} UpdateCheckNone
 * @typedef {{ kind: 'available', version: string, body?: string, update: import("@tauri-apps/plugin-updater").Update }} UpdateCheckAvailable
 * @typedef {{ kind: 'error', error: string }} UpdateCheckError
 * @typedef {UpdateCheckNone | UpdateCheckAvailable | UpdateCheckError} UpdateCheckResult
 */

/**
 * @param {UpdateCheckResult | null} result
 */
function setLastResult(result) {
  getState().lastResult = result;
}

/**
 * @returns {UpdateCheckResult | null}
 */
export function getLastUpdateResult() {
  return getState().lastResult;
}

/**
 * @param {(event: object) => void} listener
 * @returns {() => void}
 */
export function subscribeUpdateEvents(listener) {
  const state = getState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/**
 * @param {import("@tauri-apps/plugin-updater").Update | null} update
 * @param {{ emitUi?: boolean }} [options]
 * @returns {UpdateCheckResult}
 */
function processUpdateResult(update, { emitUi = true } = {}) {
  if (!update) {
    setLastResult({ kind: "none" });
    if (emitUi) notifyListeners({ type: "clear" });
    return { kind: "none" };
  }

  const result = {
    kind: "available",
    version: update.version,
    body: update.body,
    update,
  };
  setLastResult(result);
  if (emitUi && !isUpdateNoticeDismissed(update.version)) {
    notifyListeners({
      type: "available",
      update,
      version: update.version,
      body: update.body,
    });
  }
  return result;
}

/**
 * @param {{ emitUi?: boolean }} [options]
 * @returns {Promise<UpdateCheckResult>}
 */
async function runUpdateCheck({ emitUi = true } = {}) {
  if (!isTauri()) return { kind: "none" };

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    return processUpdateResult(update, { emitUi });
  } catch (error) {
    const message = error?.message || "Update check failed.";
    const result = { kind: "error", error: message };
    setLastResult(result);
    console.debug("[updater] check failed:", error);
    return result;
  }
}

const UPDATES_NOT_CONFIGURED = "Updates are not configured for this build.";

/**
 * Run a single update check on launch. Failures are silent. Idempotent.
 * Skipped for local placeholder versions (`0.0.0` / `0.0.0-dev`) — git keeps
 * empty updater endpoints; only CI-injected release builds check for updates.
 */
export function checkForUpdatesOnLaunch() {
  if (!isTauri()) return;

  const state = getState();
  if (state.started) return;
  state.started = true;

  getAppVersion()
    .then((version) => {
      if (isLocalDevAppVersion(version)) {
        console.debug("[updater] skip launch check for local dev version:", version);
        return;
      }
      return runUpdateCheck();
    })
    .catch(() => {});
}

/**
 * Manual update check with a structured result (Settings → General).
 * Does not emit UI events; caller renders inline status.
 *
 * @returns {Promise<UpdateCheckResult>}
 */
export async function checkForUpdatesManual() {
  if (!isTauri()) return { kind: "none" };

  try {
    const version = await getAppVersion();
    if (isLocalDevAppVersion(version)) {
      const result = { kind: "error", error: UPDATES_NOT_CONFIGURED };
      setLastResult(result);
      return result;
    }
  } catch (_) {
    /* fall through to check() */
  }

  return runUpdateCheck({ emitUi: false });
}

/**
 * @param {import("@tauri-apps/plugin-updater").Update} update
 */
export async function installPendingUpdate(update) {
  if (!update) {
    throw new Error("Update is not available.");
  }

  await update.downloadAndInstall(undefined, { timeout: CHECK_TIMEOUT_MS });
  await relaunch();
}
