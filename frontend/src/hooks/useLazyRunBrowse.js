import { useCallback, useRef, useState } from "react";
import {
  getRun,
  getRunCaseComments,
  getRunFolderTree,
} from "../services/api";
import {
  mergeListRunCasesIntoDetail,
  mergeRunDetailFromServer,
  mergeSavedRunResultsPreservingDirty,
} from "../utils/mergeRunDetailFromServer";
import { mergeProjectSubtreeIntoTree, folderPrefixFromTreePath } from "../utils/runCaseTree";

export { folderPrefixFromTreePath };

function loadedPrefixesForRun(ref, runId) {
  if (!ref.current.has(runId)) {
    ref.current.set(runId, new Set());
  }
  return ref.current.get(runId);
}

/**
 * Lazy run browse: header + folder tree (case list windows live in useRunCaseListWindow).
 */
export function useLazyRunBrowse(activeRepoSlug) {
  const [runDetailsByRunId, setRunDetailsByRunId] = useState({});
  const [runFolderTreeByRunId, setRunFolderTreeByRunId] = useState({});
  const [headerLoadingRunId, setHeaderLoadingRunId] = useState(null);
  const [treeLoadingRunIds, setTreeLoadingRunIds] = useState(() => new Set());
  const [savedRunResults, setSavedRunResults] = useState({});

  const browseInFlightByRunIdRef = useRef(new Map());
  const headerInFlightByRunIdRef = useRef(new Map());
  const projectSubtreeInFlightRef = useRef(new Map());
  const loadedProjectPrefixesByRunIdRef = useRef(new Map());
  /** Run IDs whose folder tree must refetch even if closure still has a cached entry. */
  const forceReloadTreeRunIdsRef = useRef(new Set());
  const runDetailsByRunIdRef = useRef(runDetailsByRunId);
  runDetailsByRunIdRef.current = runDetailsByRunId;
  const savedRunResultsRef = useRef(savedRunResults);
  savedRunResultsRef.current = savedRunResults;

  const addTreeLoadingRunId = useCallback((runId) => {
    setTreeLoadingRunIds((prev) => {
      if (prev.has(runId)) return prev;
      const next = new Set(prev);
      next.add(runId);
      return next;
    });
  }, []);

  const removeTreeLoadingRunId = useCallback((runId) => {
    setTreeLoadingRunIds((prev) => {
      if (!prev.has(runId)) return prev;
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const mergeCasesIntoRunCache = useCallback((runId, items) => {
    if (!items?.length) return;
    let dirtyPaths = new Set();
    setRunDetailsByRunId((prev) => {
      const merged = mergeListRunCasesIntoDetail(
        prev[runId],
        items,
        savedRunResultsRef.current?.[runId],
      );
      dirtyPaths = merged.dirtyPaths;
      const next = { ...prev, [runId]: merged.detail };
      runDetailsByRunIdRef.current = next;
      return next;
    });
    setSavedRunResults((prevSaved) => ({
      ...prevSaved,
      [runId]: mergeSavedRunResultsPreservingDirty(
        prevSaved[runId],
        items,
        dirtyPaths,
      ),
    }));
  }, []);

  const loadRunHeader = useCallback(
    (runId) => {
      if (!activeRepoSlug || !runId) return Promise.resolve();
      return getRun(runId, activeRepoSlug, { includeCases: false })
        .then((data) => {
          setRunDetailsByRunId((prev) => ({
            ...prev,
            [runId]: mergeRunDetailFromServer(prev[runId], {
              ...data,
              cases: prev[runId]?.cases ?? [],
            }),
          }));
        })
        .catch(() => {
          setRunDetailsByRunId((prev) => ({ ...prev, [runId]: null }));
        });
    },
    [activeRepoSlug],
  );

  const ensureRunHeaderLoaded = useCallback(
    (runId) => {
      if (!runId) return Promise.resolve();
      const inFlight = headerInFlightByRunIdRef.current.get(runId);
      if (inFlight) return inFlight;

      setHeaderLoadingRunId(runId);
      const request = loadRunHeader(runId).finally(() => {
        headerInFlightByRunIdRef.current.delete(runId);
        setHeaderLoadingRunId((current) => (current === runId ? null : current));
      });
      headerInFlightByRunIdRef.current.set(runId, request);
      return request;
    },
    [loadRunHeader],
  );

  const fetchRunFolderTree = useCallback(
    (runId, { folderPrefix = null, depth = null } = {}) => {
      if (!activeRepoSlug || !runId) return Promise.resolve();
      return getRunFolderTree(runId, activeRepoSlug, { folder_prefix: folderPrefix, depth })
        .then((tree) => {
          const nodes = Array.isArray(tree) ? tree : [];
          if (folderPrefix && depth !== "projects") {
            const projectNode = nodes.find((n) => n.directory_path === folderPrefix) ?? nodes[0];
            if (projectNode) {
              setRunFolderTreeByRunId((prev) => ({
                ...prev,
                [runId]: mergeProjectSubtreeIntoTree(prev[runId], folderPrefix, projectNode),
              }));
            }
            return nodes;
          }
          setRunFolderTreeByRunId((prev) => ({
            ...prev,
            [runId]: nodes,
          }));
          return nodes;
        })
        .catch(() => {
          if (!folderPrefix) {
            setRunFolderTreeByRunId((prev) => ({ ...prev, [runId]: [] }));
          }
          return [];
        });
    },
    [activeRepoSlug],
  );

  const loadRunProjectNodes = useCallback(
    (runId) => {
      if (!activeRepoSlug || !runId) return Promise.resolve();
      const forceReload = forceReloadTreeRunIdsRef.current.has(runId);
      if (forceReload) {
        forceReloadTreeRunIdsRef.current.delete(runId);
        loadedProjectPrefixesByRunIdRef.current.delete(runId);
      }
      const treeInClosure = runFolderTreeByRunId[runId];
      if (!forceReload && treeInClosure !== undefined) {
        return Promise.resolve(treeInClosure);
      }
      addTreeLoadingRunId(runId);
      return fetchRunFolderTree(runId, { depth: "projects" }).finally(() => {
        removeTreeLoadingRunId(runId);
      });
    },
    [activeRepoSlug, runFolderTreeByRunId, fetchRunFolderTree, addTreeLoadingRunId, removeTreeLoadingRunId],
  );

  const loadRunFolderSubtree = useCallback(
    (runId, projectRepoPath) => {
      if (!activeRepoSlug || !runId || !projectRepoPath) return Promise.resolve();
      const loaded = loadedPrefixesForRun(loadedProjectPrefixesByRunIdRef, runId);
      if (loaded.has(projectRepoPath)) return Promise.resolve();

      const inFlightKey = `${runId}\0${projectRepoPath}`;
      const inFlight = projectSubtreeInFlightRef.current.get(inFlightKey);
      if (inFlight) return inFlight;

      const request = fetchRunFolderTree(runId, {
        folderPrefix: projectRepoPath,
        depth: "full",
      })
        .then((nodes) => {
          loaded.add(projectRepoPath);
          return nodes;
        })
        .finally(() => {
          projectSubtreeInFlightRef.current.delete(inFlightKey);
        });

      projectSubtreeInFlightRef.current.set(inFlightKey, request);
      return request;
    },
    [activeRepoSlug, fetchRunFolderTree],
  );

  const loadRunFolderTree = useCallback(
    (runId) => loadRunProjectNodes(runId),
    [loadRunProjectNodes],
  );

  const reloadRunFolderTree = useCallback(
    (runId) => {
      if (!activeRepoSlug || !runId) return Promise.resolve();
      loadedProjectPrefixesByRunIdRef.current.delete(runId);
      setRunFolderTreeByRunId((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      return loadRunProjectNodes(runId);
    },
    [activeRepoSlug, loadRunProjectNodes],
  );

  const ensureRunBrowseLoaded = useCallback(
    (runId) => {
      if (!runId) return Promise.resolve();
      const inFlight = browseInFlightByRunIdRef.current.get(runId);
      if (inFlight) return inFlight;

      const request = Promise.all([
        ensureRunHeaderLoaded(runId),
        loadRunProjectNodes(runId),
      ]).finally(() => {
        browseInFlightByRunIdRef.current.delete(runId);
      });
      browseInFlightByRunIdRef.current.set(runId, request);
      return request;
    },
    [ensureRunHeaderLoaded, loadRunProjectNodes],
  );

  const loadRunCaseComments = useCallback(
    (runId, filePath) => {
      if (!activeRepoSlug || !runId || !filePath) return Promise.resolve();
      return getRunCaseComments(runId, filePath, activeRepoSlug).then((res) => {
        if (!res?.comments) return;
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.cases) return prev;
          return {
            ...prev,
            [runId]: {
              ...existing,
              cases: existing.cases.map((c) =>
                c.file_path === filePath ? { ...c, comments: res.comments } : c,
              ),
            },
          };
        });
      });
    },
    [activeRepoSlug],
  );

  const invalidateRunCasesCache = useCallback((runId) => {
    forceReloadTreeRunIdsRef.current.add(runId);
    loadedProjectPrefixesByRunIdRef.current.delete(runId);
    setRunFolderTreeByRunId((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  }, []);

  const patchRunFolderTree = useCallback((runId, patchFn) => {
    setRunFolderTreeByRunId((prev) => {
      const tree = prev[runId] ?? [];
      const nextTree = patchFn(tree);
      if (nextTree === tree) return prev;
      return { ...prev, [runId]: nextTree };
    });
  }, []);

  const restoreRunFolderTree = useCallback((runId, tree) => {
    if (tree === undefined) return;
    setRunFolderTreeByRunId((prev) => ({ ...prev, [runId]: tree }));
  }, []);

  return {
    runDetailsByRunId,
    setRunDetailsByRunId,
    runFolderTreeByRunId,
    savedRunResults,
    setSavedRunResults,
    headerLoadingRunId,
    treeLoadingRunIds,
    ensureRunBrowseLoaded,
    ensureRunHeaderLoaded,
    loadRunHeader,
    loadRunProjectNodes,
    loadRunFolderSubtree,
    loadRunFolderTree,
    reloadRunFolderTree,
    loadRunCaseComments,
    invalidateRunCasesCache,
    mergeCasesIntoRunCache,
    patchRunFolderTree,
    restoreRunFolderTree,
  };
}
