import { useCallback, useRef, useState } from "react";
import { getReleases, getTickets } from "../services/api";
import { mergeListPreserveOrder } from "../utils/mergeListPreserveOrder";

const RELEASE_FETCH_LIMIT = 200;
const TICKET_PAGE_SIZE = 100;

function releaseRowKey(r) {
  return r?.file_path || r?.release_id || null;
}

function ticketRowKey(t) {
  return t?.file_path || null;
}

/**
 * Lazy loading for project-scoped Releases navigator:
 * - releases under a ticket project
 * - tickets under a release (project + release filter)
 *
 * Uses a cache epoch so resetAll invalidates in-flight fetches (avoids stale
 * getReleases results repopulating the tree after reindex).
 */
export function useLazyReleaseTickets(activeRepoSlug) {
  const [releasesByProject, setReleasesByProject] = useState({});
  const [ticketsByReleaseId, setTicketsByReleaseId] = useState({});
  const [loadingProjects, setLoadingProjects] = useState(() => new Set());
  const [loadingReleaseIds, setLoadingReleaseIds] = useState(() => new Set());

  const releasesCacheRef = useRef(new Map());
  const ticketsCacheRef = useRef(new Map());
  const projectInFlightRef = useRef(new Map());
  const releaseInFlightRef = useRef(new Map());
  const cacheEpochRef = useRef(0);

  const addLoadingProject = useCallback((projectName) => {
    setLoadingProjects((prev) => {
      if (prev.has(projectName)) return prev;
      const next = new Set(prev);
      next.add(projectName);
      return next;
    });
  }, []);

  const removeLoadingProject = useCallback((projectName) => {
    setLoadingProjects((prev) => {
      if (!prev.has(projectName)) return prev;
      const next = new Set(prev);
      next.delete(projectName);
      return next;
    });
  }, []);

  const addLoadingRelease = useCallback((releaseId) => {
    setLoadingReleaseIds((prev) => {
      if (prev.has(releaseId)) return prev;
      const next = new Set(prev);
      next.add(releaseId);
      return next;
    });
  }, []);

  const removeLoadingRelease = useCallback((releaseId) => {
    setLoadingReleaseIds((prev) => {
      if (!prev.has(releaseId)) return prev;
      const next = new Set(prev);
      next.delete(releaseId);
      return next;
    });
  }, []);

  const ensureProjectReleases = useCallback(
    async (projectName, options = {}) => {
      if (!projectName || !activeRepoSlug) return;
      const status =
        typeof options.status === "string" && options.status.trim()
          ? options.status.trim()
          : null;
      const cacheKey = status ? `${projectName}\0${status}` : projectName;
      if (releasesCacheRef.current.has(cacheKey)) return;

      const existing = projectInFlightRef.current.get(cacheKey);
      if (existing) {
        const epochAtWait = cacheEpochRef.current;
        await existing;
        if (epochAtWait !== cacheEpochRef.current) {
          return ensureProjectReleases(projectName, options);
        }
        return;
      }

      const epoch = cacheEpochRef.current;
      addLoadingProject(projectName);
      const promise = (async () => {
        try {
          const params = {
            project: projectName,
            limit: RELEASE_FETCH_LIMIT,
            offset: 0,
          };
          if (status) params.status = status;
          const res = await getReleases(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          releasesCacheRef.current.set(cacheKey, items);
          setReleasesByProject((prev) => ({ ...prev, [projectName]: items }));
        } catch {
          if (epoch !== cacheEpochRef.current) return;
          releasesCacheRef.current.set(cacheKey, []);
          setReleasesByProject((prev) => ({ ...prev, [projectName]: [] }));
        } finally {
          if (epoch === cacheEpochRef.current) {
            removeLoadingProject(projectName);
          }
          projectInFlightRef.current.delete(cacheKey);
        }
      })();

      projectInFlightRef.current.set(cacheKey, promise);
      await promise;
    },
    [activeRepoSlug, addLoadingProject, removeLoadingProject],
  );

  /**
   * Always refetch releases for a project (ignores cache). Used for lifecycle status filters.
   */
  const reloadProjectReleases = useCallback(
    async (projectName, options = {}) => {
      if (!projectName || !activeRepoSlug) return;
      const status =
        typeof options.status === "string" && options.status.trim()
          ? options.status.trim()
          : null;
      const cacheKey = status ? `${projectName}\0${status}` : projectName;

      const existing = projectInFlightRef.current.get(cacheKey);
      if (existing) await existing;

      // Drop any prior cache entries for this project (all status variants).
      for (const key of [...releasesCacheRef.current.keys()]) {
        if (key === projectName || key.startsWith(`${projectName}\0`)) {
          releasesCacheRef.current.delete(key);
        }
      }

      const epoch = cacheEpochRef.current;
      addLoadingProject(projectName);
      const promise = (async () => {
        try {
          const params = {
            project: projectName,
            limit: RELEASE_FETCH_LIMIT,
            offset: 0,
          };
          if (status) params.status = status;
          const res = await getReleases(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          releasesCacheRef.current.set(cacheKey, items);
          setReleasesByProject((prev) => ({ ...prev, [projectName]: items }));
        } catch {
          if (epoch !== cacheEpochRef.current) return;
          releasesCacheRef.current.set(cacheKey, []);
          setReleasesByProject((prev) => ({ ...prev, [projectName]: [] }));
        } finally {
          if (epoch === cacheEpochRef.current) {
            removeLoadingProject(projectName);
          }
          projectInFlightRef.current.delete(cacheKey);
        }
      })();

      projectInFlightRef.current.set(cacheKey, promise);
      await promise;
    },
    [activeRepoSlug, addLoadingProject, removeLoadingProject],
  );

  /**
   * Drop all project release caches (all status variants) so the next ensure/reload refetches.
   */
  const invalidateAllProjectReleases = useCallback(() => {
    releasesCacheRef.current.clear();
    projectInFlightRef.current.clear();
    setReleasesByProject({});
    setLoadingProjects(new Set());
  }, []);

  const ensureReleaseTickets = useCallback(
    async (releaseId, projectName) => {
      if (!releaseId || !activeRepoSlug) return;
      if (ticketsCacheRef.current.has(releaseId)) return;

      const existing = releaseInFlightRef.current.get(releaseId);
      if (existing) {
        const epochAtWait = cacheEpochRef.current;
        await existing;
        if (epochAtWait !== cacheEpochRef.current) {
          return ensureReleaseTickets(releaseId, projectName);
        }
        return;
      }

      const epoch = cacheEpochRef.current;
      addLoadingRelease(releaseId);
      const promise = (async () => {
        try {
          const params = {
            release: releaseId,
            limit: TICKET_PAGE_SIZE,
            offset: 0,
          };
          if (projectName) params.project = projectName;
          const res = await getTickets(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          const total = typeof res?.total === "number" ? res.total : items.length;
          const window = {
            items,
            total,
            offset: items.length,
            hasMore: items.length < total,
            loading: false,
            loadingMore: false,
          };
          ticketsCacheRef.current.set(releaseId, window);
          setTicketsByReleaseId((prev) => ({ ...prev, [releaseId]: window }));
        } catch {
          if (epoch !== cacheEpochRef.current) return;
          const window = {
            items: [],
            total: 0,
            offset: 0,
            hasMore: false,
            loading: false,
            loadingMore: false,
          };
          ticketsCacheRef.current.set(releaseId, window);
          setTicketsByReleaseId((prev) => ({ ...prev, [releaseId]: window }));
        } finally {
          if (epoch === cacheEpochRef.current) {
            removeLoadingRelease(releaseId);
          }
          releaseInFlightRef.current.delete(releaseId);
        }
      })();

      releaseInFlightRef.current.set(releaseId, promise);
      await promise;
    },
    [activeRepoSlug, addLoadingRelease, removeLoadingRelease],
  );

  /**
   * Always refetch tickets for a release (ignores cache). Used for in-release search filters.
   * `release` / `project` from args win over any keys in queryParams.
   */
  const reloadReleaseTickets = useCallback(
    async (releaseId, projectName, queryParams = {}) => {
      if (!releaseId || !activeRepoSlug) return;

      const existing = releaseInFlightRef.current.get(releaseId);
      if (existing) await existing;

      const epoch = cacheEpochRef.current;
      addLoadingRelease(releaseId);
      const promise = (async () => {
        try {
          const params = {
            ...(queryParams && typeof queryParams === "object" ? queryParams : {}),
            release: releaseId,
            limit: TICKET_PAGE_SIZE,
            offset: 0,
          };
          if (projectName) params.project = projectName;
          else delete params.project;
          const res = await getTickets(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          const total = typeof res?.total === "number" ? res.total : items.length;
          const window = {
            items,
            total,
            offset: items.length,
            hasMore: items.length < total,
            loading: false,
            loadingMore: false,
          };
          ticketsCacheRef.current.set(releaseId, window);
          setTicketsByReleaseId((prev) => ({ ...prev, [releaseId]: window }));
        } catch {
          if (epoch !== cacheEpochRef.current) return;
          const window = {
            items: [],
            total: 0,
            offset: 0,
            hasMore: false,
            loading: false,
            loadingMore: false,
          };
          ticketsCacheRef.current.set(releaseId, window);
          setTicketsByReleaseId((prev) => ({ ...prev, [releaseId]: window }));
        } finally {
          if (epoch === cacheEpochRef.current) {
            removeLoadingRelease(releaseId);
          }
          releaseInFlightRef.current.delete(releaseId);
        }
      })();

      releaseInFlightRef.current.set(releaseId, promise);
      await promise;
    },
    [activeRepoSlug, addLoadingRelease, removeLoadingRelease],
  );

  /**
   * Drop only the ticket window for a release (keep project release list cache).
   */
  const clearReleaseTickets = useCallback((releaseId) => {
    if (!releaseId) return;
    ticketsCacheRef.current.delete(releaseId);
    setTicketsByReleaseId((prev) => {
      if (!(releaseId in prev)) return prev;
      const next = { ...prev };
      delete next[releaseId];
      return next;
    });
  }, []);

  const getReleaseTickets = useCallback(
    (releaseId) => ticketsByReleaseId[releaseId] ?? null,
    [ticketsByReleaseId],
  );

  const invalidateRelease = useCallback((releaseId) => {
    if (!releaseId) return;
    ticketsCacheRef.current.delete(releaseId);
    setTicketsByReleaseId((prev) => {
      if (!(releaseId in prev)) return prev;
      const next = { ...prev };
      delete next[releaseId];
      return next;
    });
    const project = releaseId.includes("/") ? releaseId.split("/")[0] : null;
    if (project) {
      for (const key of [...releasesCacheRef.current.keys()]) {
        if (key === project || key.startsWith(`${project}\0`)) {
          releasesCacheRef.current.delete(key);
        }
      }
      setReleasesByProject((prev) => {
        if (!(project in prev)) return prev;
        const next = { ...prev };
        delete next[project];
        return next;
      });
    }
  }, []);

  const invalidateProject = useCallback((projectName) => {
    if (!projectName) return;
    for (const key of [...releasesCacheRef.current.keys()]) {
      if (key === projectName || key.startsWith(`${projectName}\0`)) {
        releasesCacheRef.current.delete(key);
      }
    }
    setReleasesByProject((prev) => {
      if (!(projectName in prev)) return prev;
      const next = { ...prev };
      delete next[projectName];
      return next;
    });
  }, []);

  const patchTicketInCache = useCallback((releaseId, filePath, partial) => {
    if (!releaseId || !filePath || !partial || typeof partial !== "object") return;
    setTicketsByReleaseId((prev) => {
      const window = prev[releaseId];
      if (!window?.items?.some((t) => t.file_path === filePath)) return prev;
      const patched = {
        ...window,
        items: window.items.map((t) =>
          t.file_path === filePath ? { ...t, ...partial } : t,
        ),
      };
      ticketsCacheRef.current.set(releaseId, patched);
      return { ...prev, [releaseId]: patched };
    });
  }, []);

  /**
   * Patch a release row in the project cache without changing order.
   * @param {string} projectName
   * @param {string} filePathOrReleaseId - match by file_path or release_id
   * @param {object} partial
   */
  const patchReleaseInCache = useCallback((projectName, filePathOrReleaseId, partial) => {
    if (!projectName || !filePathOrReleaseId || !partial || typeof partial !== "object") return;
    setReleasesByProject((prev) => {
      const list = prev[projectName];
      if (!Array.isArray(list)) return prev;
      let changed = false;
      const nextList = list.map((r) => {
        if (r.file_path === filePathOrReleaseId || r.release_id === filePathOrReleaseId) {
          changed = true;
          return { ...r, ...partial };
        }
        return r;
      });
      if (!changed) return prev;
      releasesCacheRef.current.set(projectName, nextList);
      return { ...prev, [projectName]: nextList };
    });
  }, []);

  /**
   * Refetch already-loaded project release lists and ticket windows, merging
   * field updates while preserving current navigator order (newcomers prepended).
   */
  const refreshCachesPreserveOrder = useCallback(async () => {
    if (!activeRepoSlug) return;
    const epoch = cacheEpochRef.current;
    const projectCacheEntries = [...releasesCacheRef.current.entries()];
    await Promise.all(
      projectCacheEntries.map(async ([cacheKey, prevItems]) => {
        try {
          const sep = cacheKey.indexOf("\0");
          const projectName = sep >= 0 ? cacheKey.slice(0, sep) : cacheKey;
          const status = sep >= 0 ? cacheKey.slice(sep + 1) : null;
          const params = {
            project: projectName,
            limit: RELEASE_FETCH_LIMIT,
            offset: 0,
          };
          if (status) params.status = status;
          const res = await getReleases(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          const prev = Array.isArray(prevItems) ? prevItems : [];
          const merged = mergeListPreserveOrder(prev, items, releaseRowKey);
          releasesCacheRef.current.set(cacheKey, merged);
          setReleasesByProject((state) => ({ ...state, [projectName]: merged }));
        } catch {
          /* keep existing cache */
        }
      }),
    );

    const releaseEntries = [...ticketsCacheRef.current.entries()];
    await Promise.all(
      releaseEntries.map(async ([releaseId, window]) => {
        try {
          const projectName = releaseId.includes("/") ? releaseId.split("/")[0] : null;
          const params = {
            release: releaseId,
            limit: TICKET_PAGE_SIZE,
            offset: 0,
          };
          if (projectName) params.project = projectName;
          const res = await getTickets(activeRepoSlug, params);
          if (epoch !== cacheEpochRef.current) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          const total = typeof res?.total === "number" ? res.total : items.length;
          const prevItems = window?.items || [];
          const mergedItems = mergeListPreserveOrder(prevItems, items, ticketRowKey);
          const nextWindow = {
            items: mergedItems,
            total,
            offset: mergedItems.length,
            hasMore: mergedItems.length < total,
            loading: false,
            loadingMore: false,
          };
          ticketsCacheRef.current.set(releaseId, nextWindow);
          setTicketsByReleaseId((state) => ({ ...state, [releaseId]: nextWindow }));
        } catch {
          /* keep existing cache */
        }
      }),
    );
  }, [activeRepoSlug]);

  const resetAll = useCallback(() => {
    cacheEpochRef.current += 1;
    releasesCacheRef.current.clear();
    ticketsCacheRef.current.clear();
    projectInFlightRef.current.clear();
    releaseInFlightRef.current.clear();
    setReleasesByProject({});
    setTicketsByReleaseId({});
    setLoadingProjects(new Set());
    setLoadingReleaseIds(new Set());
  }, []);

  const isProjectLoading = useCallback(
    (projectName) => loadingProjects.has(projectName),
    [loadingProjects],
  );

  const isReleaseLoading = useCallback(
    (releaseId) => loadingReleaseIds.has(releaseId),
    [loadingReleaseIds],
  );

  return {
    releasesByProject,
    ticketsByReleaseId,
    ensureProjectReleases,
    reloadProjectReleases,
    invalidateAllProjectReleases,
    ensureReleaseTickets,
    reloadReleaseTickets,
    clearReleaseTickets,
    getReleaseTickets,
    invalidateRelease,
    invalidateProject,
    patchTicketInCache,
    patchReleaseInCache,
    refreshCachesPreserveOrder,
    resetAll,
    isProjectLoading,
    isReleaseLoading,
  };
}
