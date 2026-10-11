import { useEffect, useState } from "react";
import { getGitUserName } from "../services/api";

/**
 * Cached git `user.name` for the active repo (same source as comment author on post).
 *
 * @param {string | null | undefined} repoSlug
 * @param {number} [refreshKey] - Bump after profile save to refetch display name.
 * @returns {string}
 */
export function useGitUserName(repoSlug, refreshKey = 0) {
  const [userName, setUserName] = useState("");

  useEffect(() => {
    if (!repoSlug) {
      setUserName("");
      return undefined;
    }
    let cancelled = false;
    getGitUserName(repoSlug)
      .then((res) => {
        if (!cancelled) setUserName((res?.user_name ?? "").trim());
      })
      .catch(() => {
        if (!cancelled) setUserName("");
      });
    return () => {
      cancelled = true;
    };
  }, [repoSlug, refreshKey]);

  return userName;
}
