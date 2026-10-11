import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAutomationExecution,
  getAutomationResultDetail,
  listAutomationExecutions,
  listAutomationPipelines,
  syncAutomationExecutions,
} from "../services/api";
import AutomationPipelineTree from "../components/AutomationPipelineTree";
import AutomationSyncStatusLine from "../components/AutomationSyncStatusLine";
import AutomationPipelineSummaryPanel from "../components/AutomationPipelineSummaryPanel";
import AutomationCiUploadTutorialPanel from "../components/AutomationCiUploadTutorialPanel";
import AutomationExecutionSummaryPanel from "../components/AutomationExecutionSummaryPanel";
import AutomationResultDetailPanel from "../components/AutomationResultDetailPanel";
import RunVirtualCaseList from "../components/RunVirtualCaseList";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import SidebarSection from "../components/SidebarSection";
import Tooltip from "../components/Tooltip";
import DetailPanel from "../components/DetailPanel";
import DetailPanelEmpty from "../components/DetailPanelEmpty";
import DetailPanelLoading from "../components/DetailPanelLoading";
import PageMessage from "../components/PageMessage";
import { useRefetchWhenActive } from "../components/PersistentView";
import { useFetchedContent } from "../hooks/useFetchedContent";
import { useAutomationCaseListWindow } from "../hooks/useAutomationCaseListWindow";
import { useAutomationSuiteList } from "../hooks/useAutomationSuiteList";
import { getInvokeErrorMessage } from "../utils/invokeError";
import { formatAutomationSyncFeedback } from "../utils/formatAutomationSyncFeedback";

const AUTOMATION_STORAGE_KEYS = {
  treeWidth: "automation.col.treeWidth",
  listWidth: "automation.col.listWidth",
};

function Automation({
  activeRepoSlug,
  storageSyncConfigured = false,
  projectSyncConfig = null,
  sidebarFooter,
  sidebarTitleRight,
}) {
  const [pipelines, setPipelines] = useState([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [error, setError] = useState("");

  const [expandedPipelines, setExpandedPipelines] = useState({});
  const [expandedExecutions, setExpandedExecutions] = useState({});
  const [executionsByPipeline, setExecutionsByPipeline] = useState({});
  const [loadingExecutionsFor, setLoadingExecutionsFor] = useState(null);

  const [selectedPipelineName, setSelectedPipelineName] = useState(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState(null);
  const [selectedSuiteKey, setSelectedSuiteKey] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);

  const {
    suitesByExecution,
    loadingSuitesFor,
    loadSuitesForExecution,
    clearSuitesCache,
  } = useAutomationSuiteList();

  const loadPipelines = useCallback(async () => {
    if (!activeRepoSlug || !storageSyncConfigured) {
      setPipelines([]);
      return [];
    }
    setPipelinesLoading(true);
    setError("");
    try {
      const rows = await listAutomationPipelines(activeRepoSlug);
      const list = Array.isArray(rows) ? rows : [];
      setPipelines(list);
      return list;
    } catch (err) {
      setError(err?.message ?? "Failed to load pipelines");
      setPipelines([]);
      return [];
    } finally {
      setPipelinesLoading(false);
    }
  }, [activeRepoSlug, storageSyncConfigured]);

  useRefetchWhenActive(loadPipelines);

  const loadExecutionsForPipeline = useCallback(
    async (pipelineName) => {
      if (!activeRepoSlug || !pipelineName) return;
      setLoadingExecutionsFor(pipelineName);
      try {
        const rows = await listAutomationExecutions(pipelineName, activeRepoSlug, {
          limit: 100,
          offset: 0,
        });
        setExecutionsByPipeline((prev) => ({
          ...prev,
          [pipelineName]: Array.isArray(rows) ? rows : [],
        }));
      } catch (err) {
        setError(err?.message ?? "Failed to load executions");
      } finally {
        setLoadingExecutionsFor(null);
      }
    },
    [activeRepoSlug],
  );

  const handleRefresh = useCallback(async () => {
    if (!activeRepoSlug || syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    setError("");
    try {
      const res = await syncAutomationExecutions(activeRepoSlug);
      const updated = res?.updated ?? 0;
      const discovered = res?.discovered ?? 0;
      const removed = res?.removed ?? 0;
      setSyncFeedback(formatAutomationSyncFeedback({ updated, discovered, removed }));
      clearSuitesCache();
      const pipelineRows = await loadPipelines();

      if (
        selectedPipelineName &&
        !pipelineRows.some((p) => p.pipeline_name === selectedPipelineName)
      ) {
        setSelectedPipelineName(null);
        setSelectedExecutionId(null);
        setSelectedSuiteKey(null);
        setSelectedCase(null);
      } else if (selectedPipelineName && selectedExecutionId) {
        const execRows = await listAutomationExecutions(selectedPipelineName, activeRepoSlug, {
          limit: 100,
          offset: 0,
        });
        const executions = Array.isArray(execRows) ? execRows : [];
        setExecutionsByPipeline((prev) => ({
          ...prev,
          [selectedPipelineName]: executions,
        }));
        if (!executions.some((e) => e.execution_id === selectedExecutionId)) {
          setSelectedExecutionId(null);
          setSelectedSuiteKey(null);
          setSelectedCase(null);
        } else if (activeRepoSlug) {
          await loadSuitesForExecution(selectedExecutionId, activeRepoSlug);
        }
      } else if (selectedPipelineName && expandedPipelines[selectedPipelineName]) {
        await loadExecutionsForPipeline(selectedPipelineName);
      }
    } catch (err) {
      setSyncFeedback({
        tone: "error",
        text: getInvokeErrorMessage(err, "Sync failed"),
      });
    } finally {
      setSyncing(false);
    }
  }, [
    activeRepoSlug,
    syncing,
    loadPipelines,
    selectedPipelineName,
    expandedPipelines,
    loadExecutionsForPipeline,
    clearSuitesCache,
    selectedExecutionId,
    loadSuitesForExecution,
  ]);

  const handleTogglePipeline = useCallback(
    (pipelineName) => {
      setExpandedPipelines((prev) => {
        const next = { ...prev, [pipelineName]: !prev[pipelineName] };
        return next;
      });
      setSelectedPipelineName(pipelineName);
      setSelectedExecutionId(null);
      setSelectedSuiteKey(null);
      setSelectedCase(null);
      if (!expandedPipelines[pipelineName] && !executionsByPipeline[pipelineName]) {
        loadExecutionsForPipeline(pipelineName);
      }
    },
    [expandedPipelines, executionsByPipeline, loadExecutionsForPipeline],
  );

  const handleToggleExecution = useCallback(
    (pipelineName, exec) => {
      const executionId = exec?.execution_id ?? null;
      setSelectedPipelineName(pipelineName);
      setSelectedExecutionId(executionId);
      setSelectedSuiteKey(null);
      setSelectedCase(null);

      setExpandedExecutions((prev) => {
        const willExpand = !prev[executionId];
        if (willExpand && executionId && activeRepoSlug) {
          loadSuitesForExecution(executionId, activeRepoSlug);
        }
        return { ...prev, [executionId]: willExpand };
      });
    },
    [activeRepoSlug, loadSuitesForExecution],
  );

  const handleSelectSuite = useCallback((pipelineName, exec, suite) => {
    setSelectedPipelineName(pipelineName);
    setSelectedExecutionId(exec?.execution_id ?? null);
    setSelectedSuiteKey(suite?.suite_key ?? null);
    setSelectedCase(null);
  }, []);

  const handleSelectCase = useCallback((caseRow) => {
    setSelectedCase(caseRow ?? null);
  }, []);

  const selectedCaseKey =
    selectedCase?.file_path ??
    selectedCase?.filePath ??
    selectedCase?.case_key ??
    selectedCase?.caseKey ??
    null;
  const selectedCaseJUnitFile =
    selectedCase?.junit_file ?? selectedCase?.junitFile ?? null;
  const selectedCaseClassname =
    selectedCase?.case_id ?? selectedCase?.caseId ?? selectedCase?.classname ?? "";
  const selectedCaseName = selectedCase?.name ?? null;

  const {
    items: caseItems,
    total: caseTotal,
    loading: casesLoading,
    loadingMore: casesLoadingMore,
    hasMore: casesHasMore,
    loadMore: loadMoreCases,
  } = useAutomationCaseListWindow({
    executionId: selectedExecutionId,
    suiteKey: selectedSuiteKey,
    repoSlug: activeRepoSlug,
    enabled: Boolean(selectedExecutionId && activeRepoSlug),
  });

  const executionDetailSelectionKey = selectedExecutionId ?? null;
  const [executionDetail, executionDetailContentKey] = useFetchedContent(
    executionDetailSelectionKey,
    useCallback(async () => {
      if (!selectedExecutionId || !activeRepoSlug) return null;
      return getAutomationExecution(selectedExecutionId, activeRepoSlug);
    }, [selectedExecutionId, activeRepoSlug]),
  );
  const executionDetailLoading =
    executionDetailSelectionKey != null &&
    executionDetailContentKey !== executionDetailSelectionKey;

  const [caseDetail, setCaseDetail] = useState(null);
  const [caseDetailLoading, setCaseDetailLoading] = useState(false);
  const [caseDetailError, setCaseDetailError] = useState(null);

  useEffect(() => {
    if (!selectedExecutionId || !selectedCaseName || !activeRepoSlug) {
      setCaseDetail(null);
      setCaseDetailLoading(false);
      setCaseDetailError(null);
      return undefined;
    }

    let cancelled = false;
    setCaseDetailLoading(true);
    setCaseDetailError(null);

    getAutomationResultDetail(
      selectedExecutionId,
      {
        caseKey: selectedCaseKey,
        junitFile: selectedCaseJUnitFile,
        classname: selectedCaseClassname,
        name: selectedCaseName,
      },
      activeRepoSlug,
    )
      .then((data) => {
        if (!cancelled) {
          setCaseDetail(data);
          setCaseDetailLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCaseDetail(null);
          setCaseDetailError(
            getInvokeErrorMessage(err, "Failed to load test result"),
          );
          setCaseDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedExecutionId,
    selectedCaseKey,
    selectedCaseJUnitFile,
    selectedCaseClassname,
    selectedCaseName,
    activeRepoSlug,
  ]);

  const selectedPipelineSummary = useMemo(() => {
    if (!selectedPipelineName) return null;
    return pipelines.find((p) => p.pipeline_name === selectedPipelineName) ?? null;
  }, [selectedPipelineName, pipelines]);

  const selectedPipelineExecutions = useMemo(() => {
    if (!selectedPipelineName) return [];
    return executionsByPipeline[selectedPipelineName] ?? [];
  }, [selectedPipelineName, executionsByPipeline]);

  const selectedExecutionSummary = useMemo(() => {
    if (!selectedExecutionId || !selectedPipelineName) return null;
    const list = executionsByPipeline[selectedPipelineName] ?? [];
    return list.find((e) => e.execution_id === selectedExecutionId) ?? null;
  }, [selectedExecutionId, selectedPipelineName, executionsByPipeline]);

  const selectedSuiteSummary = useMemo(() => {
    if (!selectedSuiteKey || !selectedExecutionId) return null;
    const suites = suitesByExecution[selectedExecutionId] ?? [];
    return suites.find((s) => s.suite_key === selectedSuiteKey) ?? null;
  }, [selectedSuiteKey, selectedExecutionId, suitesByExecution]);

  const caseListTitle = useMemo(() => {
    const base =
      selectedExecutionSummary?.title ||
      (selectedExecutionSummary
        ? `${selectedExecutionSummary.pipeline_name} #${selectedExecutionSummary.build_id}`
        : null);
    if (!base) return null;
    if (selectedSuiteSummary?.display_name) {
      return `${base} › ${selectedSuiteSummary.display_name}`;
    }
    return base;
  }, [selectedExecutionSummary, selectedSuiteSummary]);

  if (!activeRepoSlug) {
    return (
      <PageMessage
        variant="hint"
        title="Select a workspace"
        description="Connect or choose a repository to view test automation results."
      />
    );
  }

  if (!storageSyncConfigured) {
    return (
      <PageMessage
        variant="hint"
        title="Storage sync required"
        description="Configure S3 or a shared folder under Settings → Storage Sync. CI jobs should upload JUnit XML to test_results/ in that storage."
      />
    );
  }

  const detailColumn = selectedExecutionId && selectedCase ? (
    <AutomationResultDetailPanel
      detail={caseDetail}
      preview={selectedCase}
      detailLoading={caseDetailLoading}
      detailError={caseDetailError}
    />
  ) : selectedExecutionId ? (
    executionDetailLoading ? (
      <DetailPanel>
        <DetailPanelLoading message="Loading execution…" />
      </DetailPanel>
    ) : (
      <AutomationExecutionSummaryPanel detail={executionDetail} />
    )
  ) : selectedPipelineName ? (
    <AutomationPipelineSummaryPanel
      pipeline={selectedPipelineSummary}
      executions={selectedPipelineExecutions}
      loadingExecutions={loadingExecutionsFor === selectedPipelineName}
    />
  ) : !pipelinesLoading && pipelines.length === 0 ? (
    <AutomationCiUploadTutorialPanel
      repoSlug={activeRepoSlug}
      projectSyncConfig={projectSyncConfig}
    />
  ) : (
    <DetailPanel>
      <DetailPanelEmpty
        title="Select a pipeline"
        description="Choose a pipeline to see its runs and test results"
      />
    </DetailPanel>
  );

  const caseListColumn = (
    <RunVirtualCaseList
      cases={caseItems}
      total={caseTotal}
      loading={casesLoading}
      loadingMore={casesLoadingMore}
      hasMore={casesHasMore}
      onLoadMore={loadMoreCases}
      selectedCaseFilePath={selectedCaseKey}
      onSelectCase={handleSelectCase}
      listTitle={caseListTitle}
      folderPath={selectedSuiteKey ?? selectedExecutionId}
      emptyMessage={
        selectedSuiteKey
          ? "No test cases in this suite"
          : "No test cases in this execution"
      }
      noRunMessage="Select an execution"
      showNoRunWhenEmpty
      caseResultMode="icon"
    />
  );

  return (
    <>
      <TestRepositoryThreeColumnLayout
        storageKeys={AUTOMATION_STORAGE_KEYS}
        treeColumn={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
              <SidebarSection
                title="Test automation"
                titleRight={sidebarTitleRight}
                toolbar={
                  <div className="flex pl-4">
                    <Tooltip
                      label="Pull and index JUnit results from your configured storage sync (S3 bucket or local sync folder)."
                      placement="bottom"
                    >
                      <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={syncing}
                        aria-busy={syncing}
                        className="inline-flex items-center rounded-ui bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                      >
                        {syncing ? "Loading…" : "Load from storage"}
                      </button>
                    </Tooltip>
                  </div>
                }
              />
              <AutomationSyncStatusLine
                feedback={syncFeedback}
                onDismiss={() => setSyncFeedback(null)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
              <AutomationPipelineTree
                pipelines={pipelines}
                executionsByPipeline={executionsByPipeline}
                suitesByExecution={suitesByExecution}
                expandedPipelines={expandedPipelines}
                expandedExecutions={expandedExecutions}
                loadingPipelines={pipelinesLoading}
                loadingExecutionsFor={loadingExecutionsFor}
                loadingSuitesFor={loadingSuitesFor}
                selectedPipelineName={selectedPipelineName}
                selectedExecutionId={selectedExecutionId}
                selectedSuiteKey={selectedSuiteKey}
                onTogglePipeline={handleTogglePipeline}
                onToggleExecution={handleToggleExecution}
                onSelectSuite={handleSelectSuite}
              />
            </div>
            {sidebarFooter != null ? (
              <div
                data-sidebar-footer
                className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
              >
                {sidebarFooter}
              </div>
            ) : null}
          </div>
        }
        caseListColumn={caseListColumn}
        detailColumn={detailColumn}
      />

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
    </>
  );
}

export default Automation;
