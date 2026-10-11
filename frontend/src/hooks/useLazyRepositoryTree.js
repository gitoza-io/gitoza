import { useCallback, useEffect, useRef, useState } from "react";
import { getRepositoryTree } from "../services/api";
import { runWithConcurrency } from "../utils/caseQuery";
import {
  buildProjectNodesFromDashboard,
  isProjectDirectoryPath,
  mergeFolderSubtreeIntoTree,
  mergeProjectListWithExisting,
  mergeProjectNodesFromDashboard,
} from "../utils/caseTree";

export function scheduleIdleTask(fn) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(fn);
  } else {
    setTimeout(fn, 0);
  }
}


function modeKey(archiveMode) {
  return archiveMode ? "archive" : "browse";
}

function createEmptyBucket() {
  return {
    tree: [],
    projectsReady: false,
    dirty: false,
    loadedTreePrefixes: new Set(),
    subtreeInFlight: new Map(),
    projectLoadInFlight: null,
    prefetchGeneration: 0,
  };
}

function createBucketStore() {
  return {
    browse: createEmptyBucket(),
    archive: createEmptyBucket(),
  };
}

/**
 * Lazy repository folder tree: instant project nodes, full suite subtree on project expand.
 * Browse and archive modes use separate buckets so toggling views does not reset the tree.
 *
 * @param {string|null} activeRepoSlug
 * @param {{ archiveMode?: boolean }} [options]
 */
export function useLazyRepositoryTree(activeRepoSlug, { archiveMode = false } = {}) {
  const bucketsRef = useRef(createBucketStore());
  const loadedTreePrefixesRef = useRef(new Set());
  const archiveModeRef = useRef(archiveMode);
  archiveModeRef.current = archiveMode;

  const [repositoryTree, setRepositoryTreeState] = useState([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [treeStructureLoadingPrefixes, setTreeStructureLoadingPrefixes] = useState(
    () => new Set(),
  );

  const getActiveBucket = useCallback(() => {
    return bucketsRef.current[modeKey(archiveModeRef.current)];
  }, []);

  const getBucket = useCallback((forArchiveMode) => {
    return bucketsRef.current[modeKey(forArchiveMode)];
  }, []);

  const syncLoadedPrefixesRef = useCallback((bucket) => {
    loadedTreePrefixesRef.current = bucket.loadedTreePrefixes;
  }, []);

  const syncReactStateFromBucket = useCallback(
    (bucket) => {
      setRepositoryTreeState(bucket.tree);
      setProjectsReady(bucket.projectsReady);
      syncLoadedPrefixesRef(bucket);
    },
    [syncLoadedPrefixesRef],
  );

  const setBucketTree = useCallback((bucket, treeOrUpdater) => {
    const prev = bucket.tree;
    const next =
      typeof treeOrUpdater === "function" ? treeOrUpdater(prev) : treeOrUpdater;
    bucket.tree = Array.isArray(next) ? next : [];
    if (bucket === getActiveBucket()) {
      setRepositoryTreeState(bucket.tree);
    }
  }, [getActiveBucket]);

  const resetAllBuckets = useCallback(() => {
    bucketsRef.current = createBucketStore();
    setTreeStructureLoadingPrefixes(new Set());
    syncReactStateFromBucket(getActiveBucket());
  }, [getActiveBucket, syncReactStateFromBucket]);

  const resetTree = useCallback(() => {
    resetAllBuckets();
  }, [resetAllBuckets]);

  useEffect(() => {
    resetAllBuckets();
  }, [activeRepoSlug, resetAllBuckets]);

  useEffect(() => {
    syncReactStateFromBucket(getActiveBucket());
  }, [archiveMode, getActiveBucket, syncReactStateFromBucket]);

  const addStructureLoading = useCallback((prefix) => {
    setTreeStructureLoadingPrefixes((prev) => {
      if (prev.has(prefix)) return prev;
      const next = new Set(prev);
      next.add(prefix);
      return next;
    });
  }, []);

  const removeStructureLoading = useCallback((prefix) => {
    setTreeStructureLoadingPrefixes((prev) => {
      if (!prev.has(prefix)) return prev;
      const next = new Set(prev);
      next.delete(prefix);
      return next;
    });
  }, []);

  const invalidateSubtree = useCallback((prefix) => {
    const norm = (prefix || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!norm) return;
    getActiveBucket().loadedTreePrefixes.delete(norm);
  }, [getActiveBucket]);

  const invalidateAllSubtrees = useCallback(() => {
    getActiveBucket().loadedTreePrefixes = new Set();
  }, [getActiveBucket]);

  const invalidateBucketProjectNodes = useCallback((forArchiveMode) => {
    const bucket = getBucket(forArchiveMode);
    bucket.prefetchGeneration += 1;
    bucket.projectLoadInFlight = null;
    bucket.loadedTreePrefixes = new Set();
    bucket.subtreeInFlight.clear();
    bucket.dirty = true;
    if (modeKey(forArchiveMode) === modeKey(archiveModeRef.current)) {
      syncLoadedPrefixesRef(bucket);
    }
  }, [getBucket, syncLoadedPrefixesRef]);

  const invalidateArchiveProjectNodes = useCallback(() => {
    invalidateBucketProjectNodes(true);
  }, [invalidateBucketProjectNodes]);

  const invalidateBrowseProjectNodes = useCallback(() => {
    invalidateBucketProjectNodes(false);
  }, [invalidateBucketProjectNodes]);

  const isArchiveProjectsReady = useCallback(() => {
    return bucketsRef.current.archive.projectsReady;
  }, []);

  const isArchiveBucketDirty = useCallback(() => {
    return bucketsRef.current.archive.dirty;
  }, []);

  const loadFolderSubtree = useCallback(
    async (directoryPath, { force = false, silent = false, forArchiveMode } = {}) => {
      const prefix = (directoryPath || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
      const mode =
        forArchiveMode !== undefined ? forArchiveMode : archiveModeRef.current;
      const bucket = getBucket(mode);

      if (!activeRepoSlug || !prefix || !isProjectDirectoryPath(prefix, { archiveMode: mode })) {
        return [];
      }

      if (!force && bucket.loadedTreePrefixes.has(prefix)) {
        return [];
      }

      const inFlight = bucket.subtreeInFlight.get(prefix);
      if (inFlight) return inFlight;

      const isActive = modeKey(mode) === modeKey(archiveModeRef.current);
      if (!silent && isActive) addStructureLoading(prefix);

      const request = getRepositoryTree({
        folderPrefix: prefix,
        depth: "full",
        repoSlug: activeRepoSlug,
        archiveMode: mode,
      })
        .then((data) => {
          const nodes = Array.isArray(data) ? data : [];
          const projectNode = nodes.find((n) => n.directory_path === prefix) ?? nodes[0];
          if (projectNode) {
            setBucketTree(bucket, (prev) =>
              mergeFolderSubtreeIntoTree(prev, prefix, projectNode),
            );
            bucket.loadedTreePrefixes.add(prefix);
            syncLoadedPrefixesRef(bucket);
          }
          return nodes;
        })
        .catch(() => [])
        .finally(() => {
          bucket.subtreeInFlight.delete(prefix);
          if (!silent && isActive) removeStructureLoading(prefix);
        });

      bucket.subtreeInFlight.set(prefix, request);
      return request;
    },
    [activeRepoSlug, addStructureLoading, getBucket, removeStructureLoading, setBucketTree, syncLoadedPrefixesRef],
  );

  const prefetchProjectSubtrees = useCallback(
    (projectPaths, { concurrency = 1, forArchiveMode } = {}) => {
      if (!activeRepoSlug) return;

      const mode =
        forArchiveMode !== undefined ? forArchiveMode : archiveModeRef.current;
      const bucket = getBucket(mode);
      const paths = (projectPaths || [])
        .map((p) => (p || "").trim().replace(/\\/g, "/").replace(/\/+$/, ""))
        .filter(
          (p) =>
            isProjectDirectoryPath(p, { archiveMode: mode }) &&
            !bucket.loadedTreePrefixes.has(p),
        );

      if (!paths.length) return;

      const generation = bucket.prefetchGeneration;
      const run = async () => {
        await runWithConcurrency(paths, concurrency, async (path) => {
          if (bucket.prefetchGeneration !== generation) return;
          await loadFolderSubtree(path, { silent: true, forArchiveMode: mode });
        });
      };

      scheduleIdleTask(() => {
        void run();
      });
    },
    [activeRepoSlug, getBucket, loadFolderSubtree],
  );

  const schedulePrefetchForNodes = useCallback(
    (nodes, forArchiveMode) => {
      const paths = (nodes || []).map((n) => n.directory_path).filter(Boolean);
      prefetchProjectSubtrees(paths, { forArchiveMode });
    },
    [prefetchProjectSubtrees],
  );

  const loadProjectNodesForMode = useCallback(
    async (forArchiveMode, dashboardSummary = null, { background = false } = {}) => {
      const bucket = getBucket(forArchiveMode);
      const isActive = modeKey(forArchiveMode) === modeKey(archiveModeRef.current);

      if (!activeRepoSlug) {
        if (isActive) resetAllBuckets();
        return [];
      }

      const requestGen = bucket.prefetchGeneration;

      if (!forArchiveMode && !bucket.dirty) {
        const fromDashboard = buildProjectNodesFromDashboard(dashboardSummary);
        if (fromDashboard.length > 0) {
          setBucketTree(bucket, (prev) =>
            mergeProjectNodesFromDashboard(prev, dashboardSummary),
          );
          bucket.projectsReady = true;
          bucket.dirty = false;
          if (isActive) setProjectsReady(true);
          schedulePrefetchForNodes(fromDashboard, false);
          return fromDashboard;
        }
      }

      if (bucket.projectLoadInFlight) {
        return bucket.projectLoadInFlight;
      }

      const request = getRepositoryTree({
        depth: "projects",
        repoSlug: activeRepoSlug,
        archiveMode: forArchiveMode,
      })
        .then((data) => {
          const nodes = Array.isArray(data) ? data : [];
          if (requestGen !== bucket.prefetchGeneration) return [];
          setBucketTree(bucket, (prev) => mergeProjectListWithExisting(prev, nodes));
          bucket.projectsReady = true;
          bucket.dirty = false;
          if (modeKey(forArchiveMode) === modeKey(archiveModeRef.current)) {
            setProjectsReady(true);
          }
          schedulePrefetchForNodes(nodes, forArchiveMode);
          return nodes;
        })
        .catch(() => {
          bucket.projectsReady = true;
          bucket.dirty = false;
          if (isActive) setProjectsReady(true);
          return [];
        })
        .finally(() => {
          bucket.projectLoadInFlight = null;
        });

      bucket.projectLoadInFlight = request;
      return request;
    },
    [activeRepoSlug, getBucket, resetAllBuckets, schedulePrefetchForNodes, setBucketTree],
  );

  const loadProjectNodes = useCallback(
    async (dashboardSummary = null, options = {}) => {
      return loadProjectNodesForMode(archiveModeRef.current, dashboardSummary, options);
    },
    [loadProjectNodesForMode],
  );

  const prefetchArchiveProjectNodes = useCallback(() => {
    const bucket = bucketsRef.current.archive;
    if (!activeRepoSlug || (bucket.projectsReady && !bucket.dirty)) {
      return Promise.resolve([]);
    }
    return loadProjectNodesForMode(true, null, { background: true });
  }, [activeRepoSlug, loadProjectNodesForMode]);

  const reloadArchiveProjectNodesInBackground = useCallback(() => {
    if (!activeRepoSlug) return Promise.resolve([]);
    return loadProjectNodesForMode(true, null, { background: true });
  }, [activeRepoSlug, loadProjectNodesForMode]);

  const reloadBrowseProjectNodesInBackground = useCallback(
    (dashboardSummary = null) => {
      if (!activeRepoSlug) return Promise.resolve([]);
      return loadProjectNodesForMode(false, dashboardSummary, { background: true });
    },
    [activeRepoSlug, loadProjectNodesForMode],
  );

  const setTreeDirect = useCallback(
    (treeOrUpdater) => {
      setBucketTree(getActiveBucket(), treeOrUpdater);
    },
    [getActiveBucket, setBucketTree],
  );

  const isProjectSubtreeLoaded = useCallback((directoryPath) => {
    const prefix = (directoryPath || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return getActiveBucket().loadedTreePrefixes.has(prefix);
  }, [getActiveBucket]);

  return {
    repositoryTree,
    setRepositoryTree: setTreeDirect,
    projectsReady,
    treeStructureLoadingPrefixes,
    loadProjectNodes,
    loadProjectNodesForMode,
    loadFolderSubtree,
    prefetchProjectSubtrees,
    prefetchArchiveProjectNodes,
    reloadArchiveProjectNodesInBackground,
    reloadBrowseProjectNodesInBackground,
    invalidateArchiveProjectNodes,
    invalidateBrowseProjectNodes,
    isArchiveProjectsReady,
    isArchiveBucketDirty,
    resetTree,
    invalidateSubtree,
    invalidateAllSubtrees,
    isProjectSubtreeLoaded,
    loadedTreePrefixesRef,
  };
}

export default useLazyRepositoryTree;
