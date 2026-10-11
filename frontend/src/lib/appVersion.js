import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "../utils/tauriEnv.js";

let cachedVersionPromise;

/**
 * Application semver from Tauri config (`src-tauri/tauri.conf.json`).
 * Cached so multiple callers share one IPC round-trip.
 */
export function getAppVersion() {
  if (!isTauri()) {
    return Promise.resolve("dev");
  }
  if (!cachedVersionPromise) {
    cachedVersionPromise = getVersion();
  }
  return cachedVersionPromise;
}

/**
 * @returns {{ version: string | null, loading: boolean }}
 */
export function useAppVersion() {
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion("unknown");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { version, loading };
}
