import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveAndLoadAsset } from "../services/api";
import { isTauri } from "../utils/tauriEnv";

/**
 * Resolves a cached asset path via Tauri and returns a webview-safe URL.
 * @param {string | null | undefined} repoSlug
 * @param {string | null | undefined} fileName
 * @param {string | null | undefined} [optimisticAbsolutePath] immediate preview after save
 */
export function useResolvedAssetUrl(repoSlug, fileName, optimisticAbsolutePath = null) {
  const [url, setUrl] = useState(null);
  const [absolutePath, setAbsolutePath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fileName || !repoSlug) {
      setUrl(null);
      setAbsolutePath(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!isTauri()) {
      setUrl(null);
      setAbsolutePath(null);
      setError("Assets are available in the desktop app only.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        let resolvedPath = optimisticAbsolutePath;
        if (!resolvedPath) {
          resolvedPath = await resolveAndLoadAsset(repoSlug, fileName);
        }
        if (cancelled) return;
        setAbsolutePath(resolvedPath);
        setUrl(convertFileSrc(resolvedPath));
      } catch (err) {
        if (!cancelled) {
          setUrl(null);
          setAbsolutePath(null);
          setError(err?.message || String(err) || "Failed to load asset");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [repoSlug, fileName, optimisticAbsolutePath]);

  return { url, absolutePath, loading, error };
}
