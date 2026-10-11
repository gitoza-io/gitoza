import { useCallback, useState } from "react";

const MAX_HISTORY = 3;
const MAX_FAVORITES = 20;

function storageKey(prefix, context) {
  return `search_${prefix}_${context}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return fallback;
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

/**
 * Persisted search history + favorites for a given context ("case" | "run").
 * Each entry is an array of { key, value } chips.
 *
 * @param {"case" | "run"} context
 */
export function useSearchPrefs(context) {
  const histKey = storageKey("history", context);
  const favKey = storageKey("favorites", context);

  const [history, setHistory] = useState(() => readJson(histKey, []));
  const [favorites, setFavorites] = useState(() => readJson(favKey, []));

  const pushHistory = useCallback(
    (chips) => {
      if (!chips || chips.length === 0) return;
      const serialized = JSON.stringify(chips);
      setHistory((prev) => {
        const deduped = prev.filter((h) => JSON.stringify(h) !== serialized);
        const next = [chips, ...deduped].slice(0, MAX_HISTORY);
        writeJson(histKey, next);
        return next;
      });
    },
    [histKey],
  );

  const toggleFavorite = useCallback(
    (chips) => {
      if (!chips || chips.length === 0) return;
      const serialized = JSON.stringify(chips);
      setFavorites((prev) => {
        const exists = prev.some((f) => JSON.stringify(f) === serialized);
        const next = exists
          ? prev.filter((f) => JSON.stringify(f) !== serialized)
          : [...prev, chips].slice(-MAX_FAVORITES);
        writeJson(favKey, next);
        return next;
      });
    },
    [favKey],
  );

  const isFavorite = useCallback(
    (chips) => {
      if (!chips || chips.length === 0) return false;
      const serialized = JSON.stringify(chips);
      return favorites.some((f) => JSON.stringify(f) === serialized);
    },
    [favorites],
  );

  return { history, favorites, pushHistory, toggleFavorite, isFavorite };
}
