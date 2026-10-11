import { invoke } from "@tauri-apps/api/core";
import {
  normalizeProjectSyncConfig,
  toSetProjectSyncConfigPayload,
} from "../utils/normalizeProjectSyncConfig";

// ---------------------------------------------------------------------------
// Terms of Service (AGB)
// ---------------------------------------------------------------------------

export const getAgbStatus = () => invoke("get_agb_status");

export const recordAgbAcceptance = () => invoke("record_agb_acceptance");

// ---------------------------------------------------------------------------
// Repo connection & management
// ---------------------------------------------------------------------------

export const getRepoConnection = () => invoke("get_repo_connection");

export const connectRepo = (payload) => invoke("connect_repo", { payload });

export const createPlayground = () => invoke("create_playground");

export const playgroundSaveChanges = (repoSlug = null) =>
  invoke("playground_save_changes", { repo: repoSlug || null });

export const getSshStatus = () => invoke("get_ssh_status");

export const getRepos = () => invoke("list_repos");

export const deleteRepo = (slug) => invoke("delete_repo", { slug });

export const quickSyncRepo = (repoSlug) =>
  invoke("quick_sync_repo", { repo: repoSlug || null });

export const indexFromGitStatus = (repoSlug = null) =>
  invoke("index_from_git_status", { repo: repoSlug });

// ---------------------------------------------------------------------------
// Repo status
// ---------------------------------------------------------------------------

export const getRepoStatus = (repoSlug = null, opts = {}) => {
  const syncDisabled = opts.sync === false;
  return invoke("get_repo_status", {
    repo: repoSlug || null,
    sync: syncDisabled ? false : null,
  });
};

export const setProjectTestConfig = (enableReviewSystem, repoSlug = null) =>
  invoke("set_project_test_config", {
    repo: repoSlug || null,
    payload: { enable_review_system: enableReviewSystem },
  });

/** Save review toggle + module visibility into `.gitoza/config.json`. */
export const setProjectFeatureFlags = (payload, repoSlug = null) =>
  invoke("set_project_feature_flags", {
    repo: repoSlug || null,
    payload: {
      enable_review_system: payload.enable_review_system !== false,
      modules: payload.modules ?? {},
    },
  });

export const getProjectSyncConfig = async (repoSlug = null) => {
  const raw = await invoke("get_project_sync_config", { repo: repoSlug || null });
  return normalizeProjectSyncConfig(raw);
};

export const setProjectSyncConfig = async (repoSlug, payload) => {
  const p = toSetProjectSyncConfigPayload(payload);
  const invokeArgs = {
    repo: repoSlug || null,
    providerType: (p.provider_type ?? p.providerType ?? "").trim(),
    localAssetsPath: p.local_assets_path ?? p.localAssetsPath ?? null,
    s3Bucket: p.s3_bucket ?? p.s3Bucket ?? null,
    s3Region: p.s3_region ?? p.s3Region ?? null,
    s3Prefix: p.s3_prefix ?? p.s3Prefix ?? null,
    s3Endpoint: p.s3_endpoint ?? p.s3Endpoint ?? null,
    accessKeyId: p.access_key_id ?? p.accessKeyId ?? null,
    secretAccessKey: p.secret_access_key ?? p.secretAccessKey ?? null,
  };
  const raw = await invoke("set_project_sync_config", invokeArgs);
  return normalizeProjectSyncConfig(raw);
};

export const verifyAndResolveS3State = async (repoSlug, { activate = false } = {}) => {
  const raw = await invoke("verify_and_resolve_s3_state", {
    repo: repoSlug || null,
    activate: Boolean(activate),
  });
  return raw;
};

export const linkRepoToGlobalS3Profile = async (repoSlug) => {
  const raw = await invoke("link_repo_to_global_s3_profile", {
    repo: repoSlug || null,
  });
  return raw;
};

export const probeGlobalS3Onboarding = async () => {
  const raw = await invoke("probe_global_s3_onboarding");
  return raw;
};

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const ensureDraftBranch = (repoSlug = null) =>
  invoke("workflow_ensure_draft", { repo: repoSlug });

export const confirmChanges = (repoSlug = null) =>
  invoke("confirm_changes", { repo: repoSlug });

export const getPushFailedStatus = (repoSlug = null) =>
  invoke("workflow_push_failed_status", { repo: repoSlug });

export const resolveRebase = (resolvedFiles, repoSlug = null) =>
  invoke("resolve_rebase", {
    repo: repoSlug,
    payload: { resolved_files: resolvedFiles },
  });

export const abortRebase = (repoSlug = null) =>
  invoke("abort_rebase", { repo: repoSlug });

export const recoverConfirmWorkflow = (repoSlug = null) =>
  invoke("recover_confirm_workflow", { repo: repoSlug });

export const prefetchRepo = (repoSlug = null) =>
  invoke("prefetch_repo", { repo: repoSlug });

export const capturePendingChanges = async (repoSlug = null) => {
  const data = await invoke("capture_pending_changes", { repo: repoSlug });
  return {
    files: data?.files ?? [],
    changes: data?.changes ?? [],
  };
};

export const clearPendingChanges = (repoSlug = null, opts = {}) =>
  invoke("clear_pending_changes", {
    repo: repoSlug,
    unstage: !!opts.unstage,
  });

export const discardPendingPaths = async (repoSlug = null, opts = {}) => {
  const data = await invoke("discard_pending_paths", {
    repo: repoSlug,
    payload: {
      paths: opts.paths ?? [],
      changes: opts.changes ?? [],
    },
  });
  return {
    files: data?.files ?? [],
    changes: data?.changes ?? [],
  };
};

export const getUnstagedDiffFiles = async (repoSlug = null) => {
  const data = await invoke("get_pending_diff_files", { repo: repoSlug });
  return {
    files: data?.files ?? [],
    changes: data?.changes ?? [],
  };
};

export const getFileDiff = async (filePath, repoSlug = null) => {
  const data = await invoke("get_pending_diff_content", {
    repo: repoSlug,
    filePath,
  });
  return data?.content ?? "";
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const getCases = (repoSlug = null, extraParams = {}) =>
  invoke("list_cases", {
    repo: repoSlug || null,
    search: extraParams.search || null,
    status: extraParams.status || null,
    priority: extraParams.priority || null,
    tag: extraParams.tag || null,
    directory: extraParams.directory || null,
    directories: extraParams.directories || null,
    pathPrefix: extraParams.path_prefix || extraParams.pathPrefix || null,
    approveStatus: extraParams.approve_status || null,
    updatedBy: extraParams.updated_by || extraParams.updatedBy || null,
    assignedTo: extraParams.assigned_to || extraParams.assignedTo || null,
    requirementId: extraParams.requirement_id || extraParams.requirementId || null,
    automated:
      extraParams.automated === true || extraParams.automated === false
        ? extraParams.automated
        : null,
    paramFilters: extraParams.param_filters || extraParams.paramFilters || null,
    includeArchived: extraParams.include_archived ?? extraParams.includeArchived ?? null,
    sortBy: extraParams.sort_by || null,
    sortDir: extraParams.sort_dir || null,
    limit: extraParams.limit ?? null,
    offset: extraParams.offset ?? null,
  });

export const getCaseFilters = (repoSlug = null) =>
  invoke("get_case_filters", { repo: repoSlug });

export const getWorkspaceUsernames = (repoSlug = null) =>
  invoke("get_workspace_usernames", { repo: repoSlug });

export const getCaseDetail = (filePath, repoSlug = null) =>
  invoke("get_case_detail", { filePath, repo: repoSlug || null });

export const exportCasesPdf = (payload, repoSlug = null) =>
  invoke("export_cases_pdf", {
    repo: repoSlug || null,
    payload,
  });

export const exportRunsPdf = (runs, repoSlug = null) =>
  invoke("export_runs_pdf", {
    repo: repoSlug || null,
    payload: { runs },
  });

export const getDashboardSummary = (repoSlug = null) =>
  invoke("get_dashboard_summary", { repo: repoSlug });

/**
 * @param {string | { project?: string, folderPrefix?: string, depth?: 'projects' | 'full', repoSlug?: string | null } | undefined} projectOrOptions
 * @param {string | null} [repoSlug]
 */
export const getRepositoryTree = (projectOrOptions = undefined, repoSlug = null) => {
  let project = null;
  let folderPrefix = null;
  let depth = null;
  let archiveMode = null;
  let slug = repoSlug;

  if (projectOrOptions != null && typeof projectOrOptions === "object" && !Array.isArray(projectOrOptions)) {
    project =
      projectOrOptions.project != null && projectOrOptions.project !== ""
        ? projectOrOptions.project
        : null;
    folderPrefix =
      projectOrOptions.folderPrefix != null && projectOrOptions.folderPrefix !== ""
        ? projectOrOptions.folderPrefix
        : null;
    depth =
      projectOrOptions.depth != null && projectOrOptions.depth !== ""
        ? projectOrOptions.depth
        : null;
    archiveMode =
      projectOrOptions.archiveMode != null ? projectOrOptions.archiveMode : null;
    slug = projectOrOptions.repoSlug ?? repoSlug;
  } else if (projectOrOptions != null && projectOrOptions !== "") {
    project = projectOrOptions;
  }

  return invoke("get_repository_tree", {
    repo: slug || null,
    project,
    folderPrefix,
    depth,
    archiveMode,
  });
};

// ---------------------------------------------------------------------------
// Case CRUD
// ---------------------------------------------------------------------------

export const createTestCase = (payload, repoSlug = null) =>
  invoke("create_case", {
    payload: { ...payload, repo: repoSlug || undefined },
  });

export const createTestCasesBatch = (cases, repoSlug = null) =>
  invoke("batch_create_cases", {
    payload: { cases, repo: repoSlug || undefined },
  });

export const updateCase = (filePath, payload, repoSlug = null) =>
  invoke("update_case", {
    filePath,
    repo: repoSlug || null,
    title: payload.title,
    tags: payload.tags ?? [],
    status: payload.status,
    priority: payload.priority,
    body: payload.body ?? null,
    requirementIds: payload.requirement_ids ?? payload.requirementIds ?? null,
    assignedTo: payload.assigned_to ?? null,
    automated: payload.automated ?? false,
    params: payload.params ?? null,
  });

export const linkCaseRequirement = (filePath, ticketId, repoSlug = null) =>
  invoke("link_case_requirement", {
    filePath,
    ticketId,
    repo: repoSlug || null,
  });

export const unlinkCaseRequirement = (filePath, ticketId, repoSlug = null) =>
  invoke("unlink_case_requirement", {
    filePath,
    ticketId,
    repo: repoSlug || null,
  });

export const saveTestAsset = (projectId, fileName, fileBytes) =>
  invoke("save_test_asset", { projectId, fileName, fileBytes });

export const syncPendingAssets = (projectId) =>
  invoke("sync_pending_assets", { projectId });

export const resolveAndLoadAsset = (projectId, fileName) =>
  invoke("resolve_and_load_asset", { projectId, fileName });

export const deleteLocalAsset = (projectId, fileName) =>
  invoke("delete_local_asset", { projectId, fileName });

export const postCaseComment = (filePath, text, repoSlug = null) =>
  invoke("post_case_comment", { filePath, text, repo: repoSlug || null });

export const deleteCaseComment = (filePath, index, repoSlug = null) =>
  invoke("delete_case_comment", { filePath, index, repo: repoSlug || null });

export const getGitUserName = (repoSlug = null) =>
  invoke("get_git_user_name", { repo: repoSlug || null });

export const getGitProfile = (repoSlug = null) =>
  invoke("get_git_profile", { repo: repoSlug || null });

export const setGitProfile = ({
  globalUserName = "",
  globalUserEmail = "",
  localUserName = "",
  localUserEmail = "",
  repo = null,
}) =>
  invoke("set_git_profile", {
    repo: repo || null,
    payload: {
      global_user_name: globalUserName,
      global_user_email: globalUserEmail,
      local_user_name: localUserName,
      local_user_email: localUserEmail,
    },
  });

export const syncGitUserCache = (repoSlug = null) =>
  invoke("sync_git_user_cache", { repo: repoSlug || null });

export const approveCase = (filePath, approveStatus, repoSlug = null) =>
  invoke("approve_case", {
    filePath,
    repo: repoSlug || null,
    payload: { approve_status: approveStatus },
  });

export const archiveCase = (filePath, reason, repoSlug = null) =>
  invoke("archive_case", {
    repo: repoSlug || null,
    payload: { file_path: filePath, reason: reason || "" },
  });

export const archiveCases = (filePaths, reason, repoSlug = null) =>
  invoke("archive_cases", {
    repo: repoSlug || null,
    payload: { file_paths: filePaths, reason: reason || "" },
  });

export const restoreCase = (filePath, repoSlug = null) =>
  invoke("restore_case", {
    repo: repoSlug || null,
    payload: { file_path: filePath },
  });

export const restoreCases = (filePaths, repoSlug = null) =>
  invoke("restore_cases", {
    repo: repoSlug || null,
    payload: { file_paths: filePaths },
  });

export const restoreFolder = (directoryPath, repoSlug = null) =>
  invoke("restore_folder", {
    repo: repoSlug || null,
    payload: { directory_path: directoryPath },
  });

export const archiveFolder = (directoryPath, reason, repoSlug = null) =>
  invoke("archive_folder", {
    repo: repoSlug || null,
    payload: { directory_path: directoryPath, reason: reason || "" },
  });

export const deleteCase = (filePath, repoSlug = null) =>
  invoke("delete_case", { filePath, repo: repoSlug || null });

export const renameCase = (filePath, newCaseId, repoSlug = null) =>
  invoke("rename_case", {
    payload: {
      file_path: filePath,
      new_case_id: newCaseId,
      repo: repoSlug || undefined,
    },
  });

export const moveCase = (filePath, targetFolder, repoSlug = null) =>
  invoke("move_case", {
    payload: {
      file_path: filePath,
      target_folder: targetFolder,
      repo: repoSlug || undefined,
    },
  });

export const forceReindex = (repoSlug = null) =>
  invoke("reindex_cases", { repo: repoSlug, stampExternal: true });

// ---------------------------------------------------------------------------
// Case templates
// ---------------------------------------------------------------------------

export const listCaseTemplates = (repoSlug = null) =>
  invoke("list_case_templates", { repo: repoSlug });

export const getCaseTemplateContent = (filePath, repoSlug = null) =>
  invoke("get_case_template_content", {
    repo: repoSlug,
    filePath,
  });

export const saveCaseTemplate = ({ name, body }, repoSlug = null) =>
  invoke("save_case_template", {
    repo: repoSlug,
    payload: { name, body },
  });

// ---------------------------------------------------------------------------
// Projects & Folders
// ---------------------------------------------------------------------------

export const createProject = (projectName, repoSlug = null) =>
  invoke("create_project", {
    payload: { project_name: projectName, repo: repoSlug || undefined },
  });

export const deleteProject = (directoryPath, repoSlug = null) =>
  invoke("delete_project", {
    payload: {
      directory_path: directoryPath,
      repo: repoSlug || undefined,
    },
  });

export const createFolder = (parentPath, folderName, repoSlug = null) =>
  invoke("create_folder", {
    payload: {
      parent_path: parentPath,
      folder_name: folderName,
      repo: repoSlug || undefined,
    },
  });

export const deleteFolder = (folderPath, repoSlug = null) =>
  invoke("delete_folder", {
    payload: { folder_path: folderPath, repo: repoSlug || undefined },
  });

export const renameFolder = (folderPath, newName, repoSlug = null) =>
  invoke("rename_folder", {
    payload: {
      folder_path: folderPath,
      new_name: newName,
      repo: repoSlug || undefined,
    },
  });

// ---------------------------------------------------------------------------
// Test runs
// ---------------------------------------------------------------------------

export const listRuns = (repoSlug = null, opts = {}) =>
  invoke("list_runs", {
    repo: repoSlug,
    includeArchived: opts.includeArchived ?? null,
    archivedOnly: opts.archivedOnly ?? null,
    search: opts.search ?? null,
    approveStatus: opts.approve_status ?? null,
    requirementId: opts.requirement_id ?? opts.requirementId ?? null,
    requirementIds: opts.requirement_ids ?? opts.requirementIds ?? null,
    release: opts.release ?? null,
  });

export const searchRunCases = (repoSlug = null, extraParams = {}) =>
  invoke("search_run_cases", {
    repo: repoSlug || null,
    search: extraParams.search || null,
    tag: extraParams.tag || null,
    priority: extraParams.priority || null,
    requirementId: extraParams.requirement_id || extraParams.requirementId || null,
    executedBy: extraParams.executed_by || extraParams.executedBy || null,
    assignedTo: extraParams.assigned_to || extraParams.assignedTo || null,
    automated:
      extraParams.automated === true || extraParams.automated === false
        ? extraParams.automated
        : null,
    result: extraParams.result || null,
    includeArchived: extraParams.include_archived ?? extraParams.includeArchived ?? null,
    limit: extraParams.limit ?? null,
    offset: extraParams.offset ?? null,
  });

export const getRunCaseFilters = (repoSlug = null) =>
  invoke("get_run_case_filters", { repo: repoSlug });

export const getRun = (runId, repoSlug = null, opts = {}) =>
  invoke("get_run", {
    runId,
    repo: repoSlug,
    includeCases: opts.includeCases ?? false,
    includeCaseComments: opts.includeCaseComments ?? false,
  });

export const listRunCases = (runId, repoSlug = null, params = {}) =>
  invoke("list_run_cases", {
    runId,
    repo: repoSlug || null,
    folderPrefix: params.folder_prefix ?? params.folderPrefix ?? null,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
  });

/** Fetch every case row for a run via paginated list_run_cases. */
export async function fetchAllRunCases(runId, repoSlug = null, pageSize = 500) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const res = await listRunCases(runId, repoSlug, { limit: pageSize, offset });
    const items = res?.items ?? [];
    all.push(...items);
    total = res?.total ?? 0;
    offset += pageSize;
    if (items.length === 0) break;
  }
  return all;
}

export const listRunCasePaths = (runId, repoSlug = null) =>
  invoke("list_run_case_paths", { runId, repo: repoSlug || null });

/** Fetch every case path for a run in one lightweight IPC call. */
export async function fetchAllRunCasePaths(runId, repoSlug = null) {
  const res = await listRunCasePaths(runId, repoSlug);
  return res?.paths ?? [];
}

export const getRunFolderTree = (runId, repoSlug = null, params = {}) =>
  invoke("get_run_folder_tree", {
    runId,
    repo: repoSlug || null,
    folderPrefix: params.folder_prefix ?? params.folderPrefix ?? null,
    depth: params.depth ?? null,
  });

export const getRunCaseComments = (runId, filePath, repoSlug = null) =>
  invoke("get_run_case_comments", {
    runId,
    filePath,
    repo: repoSlug || null,
  });

export const getRunCaseContent = (runId, filePath, repoSlug = null) =>
  invoke("get_run_case_content", {
    runId,
    filePath,
    repo: repoSlug,
  });

export const createRun = (payload, repoSlug = null) =>
  invoke("create_run", { repo: repoSlug, payload });

export const archiveRun = (runId, archived, repoSlug = null) =>
  invoke("patch_run", { runId, repo: repoSlug, payload: { archived } });

export const restoreRun = (runId, repoSlug = null) =>
  invoke("restore_run", { runId, repo: repoSlug });

export const deleteRun = (runId, repoSlug = null) =>
  invoke("delete_run", { runId, repo: repoSlug });

export const patchRun = (runId, payload, repoSlug = null) =>
  invoke("patch_run", { runId, repo: repoSlug, payload });

export const linkRunRequirement = (runId, ticketId, repoSlug = null) =>
  invoke("link_run_requirement", {
    runId,
    ticketId,
    repo: repoSlug || null,
  });

export const unlinkRunRequirement = (runId, ticketId, repoSlug = null) =>
  invoke("unlink_run_requirement", {
    runId,
    ticketId,
    repo: repoSlug || null,
  });

export const patchRunCase = (runId, filePath, payload, repoSlug = null) =>
  invoke("patch_run_case", {
    runId,
    filePath,
    repo: repoSlug,
    payload,
  });

export const postRunComment = (runId, text, repoSlug = null) =>
  invoke("post_run_comment", { runId, text, repo: repoSlug || null });

export const postRunCaseComment = (runId, filePath, text, repoSlug = null) =>
  invoke("post_run_case_comment", {
    runId,
    filePath,
    text,
    repo: repoSlug || null,
  });

export const deleteRunComment = (runId, index, repoSlug = null) =>
  invoke("delete_run_comment", { runId, index, repo: repoSlug || null });

export const deleteRunCaseComment = (runId, filePath, index, repoSlug = null) =>
  invoke("delete_run_case_comment", {
    runId,
    filePath,
    index,
    repo: repoSlug || null,
  });

export const approveRun = (runId, approveStatus, repoSlug = null) =>
  invoke("approve_run", {
    runId,
    repo: repoSlug,
    payload: { approve_status: approveStatus },
  });

export const duplicateRun = (runId, payload, repoSlug = null) =>
  invoke("duplicate_run", { runId, repo: repoSlug, payload });

export const addRunCases = (runId, payload, repoSlug = null) =>
  invoke("add_run_cases", { runId, repo: repoSlug, payload });

export const removeRunCases = (runId, { file_paths } = {}, repoSlug = null) =>
  invoke("remove_run_cases", {
    runId,
    repo: repoSlug,
    filePaths: file_paths ?? null,
  });

export const setRunResult = (runId, filePath, payload, repoSlug = null) =>
  invoke("set_run_result", {
    runId,
    filePath,
    repo: repoSlug,
    payload,
  });

export const setRunResultsBatch = (runId, payload, repoSlug = null) =>
  invoke("set_run_results_batch", { runId, repo: repoSlug, payload });

export const getRunBreakdown = (runId, repoSlug = null) =>
  invoke("get_run_breakdown", { runId, repo: repoSlug });

export const getProjectCaseBreakdown = (projectPath, repoSlug = null) =>
  invoke("get_project_case_breakdown", { projectPath, repo: repoSlug });

export const flushPendingRunYaml = (repoSlug = null) =>
  invoke("flush_pending_run_yaml", { repo: repoSlug });

export const ensureBaselineSync = (repoSlug = null) =>
  invoke("ensure_baseline_sync", { repo: repoSlug });

// ---------------------------------------------------------------------------
// Test automation (CI JUnit)
// ---------------------------------------------------------------------------

export const syncAutomationExecutions = (repoSlug = null) =>
  invoke("sync_automation_executions", { repo: repoSlug });

export const listAutomationPipelines = (repoSlug = null) =>
  invoke("list_automation_pipelines", { repo: repoSlug });

export const listAutomationExecutions = (
  pipelineName,
  repoSlug = null,
  { limit = 50, offset = 0 } = {},
) =>
  invoke("list_automation_executions", {
    repo: repoSlug,
    pipelineName,
    limit,
    offset,
  });

export const getAutomationExecution = (executionId, repoSlug = null) =>
  invoke("get_automation_execution", { repo: repoSlug, executionId });

export const listAutomationResults = (
  executionId,
  repoSlug = null,
  { limit = 50, offset = 0, suiteKey = null } = {},
) =>
  invoke("list_automation_results", {
    repo: repoSlug,
    executionId,
    suiteKey,
    limit,
    offset,
  });

export const listAutomationSuites = (executionId, repoSlug = null) =>
  invoke("list_automation_suites", { repo: repoSlug, executionId });

export const getAutomationResultDetail = (
  executionId,
  { caseKey = null, junitFile = null, classname = null, name = null } = {},
  repoSlug = null,
) =>
  invoke("get_automation_result_detail", {
    repo: repoSlug,
    executionId,
    caseKey,
    junitFile,
    classname,
    name,
  });

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const getTickets = (repoSlug = null, extraParams = {}) =>
  invoke("list_tickets", {
    repo: repoSlug || null,
    search: extraParams.search || extraParams.q || null,
    status: extraParams.status || null,
    priority: extraParams.priority || null,
    ticketType: extraParams.ticket_type || extraParams.ticketType || extraParams.type || null,
    tag: extraParams.tag || null,
    assignedTo: extraParams.assigned_to || extraParams.assignedTo || null,
    sprint: extraParams.sprint || null,
    release: extraParams.release || null,
    project: extraParams.project || null,
    parent: extraParams.parent || null,
    ticketId: extraParams.ticket_id || extraParams.ticketId || null,
    paramFilters: extraParams.param_filters || extraParams.paramFilters || null,
    sortBy: extraParams.sort_by || extraParams.sortBy || null,
    sortDir: extraParams.sort_dir || extraParams.sortDir || null,
    limit: extraParams.limit ?? null,
    offset: extraParams.offset ?? null,
  });

export const getTicketFilters = (repoSlug = null) =>
  invoke("get_ticket_filters", { repo: repoSlug });

export const getTicketDetail = (filePath, repoSlug = null) =>
  invoke("get_ticket_detail", { filePath, repo: repoSlug || null });

export const listTicketProjects = (repoSlug = null, { archivedOnly = false } = {}) =>
  invoke("list_ticket_projects", {
    repo: repoSlug || null,
    archivedOnly: archivedOnly || false,
  });

export const createTicketProject = (projectName, repoSlug = null) =>
  invoke("create_ticket_project", {
    payload: {
      project_name: projectName,
      repo: repoSlug || undefined,
    },
  });

export const getTicketProject = (projectName, repoSlug = null) =>
  invoke("get_ticket_project", {
    projectName,
    repo: repoSlug || null,
  });

export const updateTicketProject = (projectName, { description = "" } = {}, repoSlug = null) =>
  invoke("update_ticket_project", {
    payload: {
      project_name: projectName,
      description,
      repo: repoSlug || undefined,
    },
  });

export const getTicketProjectBreakdown = (projectName, repoSlug = null) =>
  invoke("get_ticket_project_breakdown", {
    projectName,
    repo: repoSlug || null,
  });

export const getReleaseTicketBreakdown = (releaseId, repoSlug = null) =>
  invoke("get_release_ticket_breakdown", {
    releaseId,
    repo: repoSlug || null,
  });

export const setTicketProjectArchived = (projectName, archived, repoSlug = null) =>
  invoke("set_ticket_project_archived", {
    payload: {
      project_name: projectName,
      archived: Boolean(archived),
      repo: repoSlug || undefined,
    },
  });

export const deleteTicketProject = (projectName, repoSlug = null) =>
  invoke("delete_ticket_project", {
    payload: {
      project_name: projectName,
      repo: repoSlug || undefined,
    },
  });

export const createTicket = (payload, repoSlug = null) =>
  invoke("create_ticket", {
    payload: {
      ...(payload.ticket_id ? { ticket_id: payload.ticket_id } : {}),
      title: payload.title,
      project: payload.project,
      priority: payload.priority ?? "medium",
      status: payload.status ?? "open",
      type: payload.type ?? payload.ticket_type ?? "task",
      tags: payload.tags ?? [],
      assigned_to: payload.assigned_to ?? "",
      reporter: payload.reporter ?? "",
      sprint: payload.sprint ?? "",
      release: payload.release ?? "",
      parent: payload.parent ?? "",
      body: payload.body ?? null,
      params: payload.params ?? {},
      repo: repoSlug || undefined,
    },
  });

export const updateTicket = (filePath, payload, repoSlug = null) =>
  invoke("update_ticket", {
    filePath,
    repo: repoSlug || null,
    title: payload.title,
    tags: payload.tags ?? [],
    status: payload.status,
    priority: payload.priority,
    ticketType: payload.type ?? payload.ticket_type ?? null,
    body: payload.body ?? null,
    assignedTo: payload.assigned_to ?? null,
    sprint: payload.sprint ?? null,
    release: payload.release ?? null,
    parent: payload.parent ?? null,
    params: payload.params ?? null,
  });

export const renameTicket = (filePath, newTicketId, repoSlug = null) =>
  invoke("rename_ticket", {
    payload: {
      file_path: filePath,
      new_ticket_id: newTicketId,
      repo: repoSlug || undefined,
    },
  });

export const postTicketComment = (filePath, text, repoSlug = null) =>
  invoke("post_ticket_comment", { filePath, text, repo: repoSlug || null });

export const deleteTicketComment = (filePath, index, repoSlug = null) =>
  invoke("delete_ticket_comment", { filePath, index, repo: repoSlug || null });

export const reindexTickets = (repoSlug = null) =>
  invoke("reindex_tickets", { repo: repoSlug || null });

// ---------------------------------------------------------------------------
// Ticket releases
// ---------------------------------------------------------------------------

export const getReleases = (repoSlug = null, extraParams = {}) =>
  invoke("list_releases", {
    repo: repoSlug || null,
    search: extraParams.search || extraParams.q || null,
    project: extraParams.project || null,
    projectEmpty: extraParams.project_empty ?? extraParams.projectEmpty ?? null,
    releaseId: extraParams.release_id || extraParams.releaseId || null,
    status: extraParams.status || null,
    limit: extraParams.limit ?? null,
    offset: extraParams.offset ?? null,
  });

export const getReleaseFilters = (repoSlug = null) =>
  invoke("get_release_filters", { repo: repoSlug });

export const getReleaseDetail = (filePath, repoSlug = null) =>
  invoke("get_release_detail", { filePath, repo: repoSlug || null });

export const createRelease = (payload, repoSlug = null) =>
  invoke("create_release", {
    payload: {
      name: payload.name,
      project: payload.project ?? "",
      status: payload.status ?? "open",
      body: payload.body ?? null,
      repo: repoSlug || undefined,
    },
  });

export const updateRelease = (filePath, payload, repoSlug = null) =>
  invoke("update_release", {
    filePath,
    repo: repoSlug || null,
    name: payload.name,
    project: payload.project ?? null,
    status: payload.status ?? null,
    body: payload.body ?? null,
  });

export const reindexReleases = (repoSlug = null) =>
  invoke("reindex_releases", { repo: repoSlug || null });

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

export const getWikiPages = (repoSlug = null, extraParams = {}) =>
  invoke("list_wiki_pages", {
    repo: repoSlug || null,
    search: extraParams.search || extraParams.q || null,
    tag: extraParams.tag || null,
    status: extraParams.status || null,
    folder: extraParams.folder || null,
    pageId: extraParams.page_id || extraParams.pageId || null,
    sortBy: extraParams.sort_by || extraParams.sortBy || null,
    sortDir: extraParams.sort_dir || extraParams.sortDir || null,
    limit: extraParams.limit ?? null,
    offset: extraParams.offset ?? null,
    includeArchived: extraParams.includeArchived ?? extraParams.include_archived ?? null,
    archivedOnly: extraParams.archivedOnly ?? extraParams.archived_only ?? null,
  });

export const getWikiFilters = (repoSlug = null) =>
  invoke("get_wiki_filters", { repo: repoSlug });

export const getWikiPageDetail = (filePath, repoSlug = null) =>
  invoke("get_wiki_page_detail", { filePath, repo: repoSlug || null });

export const getWikiTree = (repoSlug = null, extraParams = {}) =>
  invoke("get_wiki_tree", {
    repo: repoSlug || null,
    archiveMode: extraParams.archiveMode ?? extraParams.archive_mode ?? null,
  });

export const createWikiFolder = (parentPath, folderName, repoSlug = null) =>
  invoke("create_wiki_folder", {
    payload: {
      parent_path: parentPath,
      folder_name: folderName,
      repo: repoSlug || undefined,
    },
  });

export const createWikiPage = (payload, repoSlug = null) =>
  invoke("create_wiki_page", {
    payload: {
      title: payload.title,
      folder: payload.folder,
      tags: payload.tags ?? [],
      body: payload.body ?? null,
      repo: repoSlug || undefined,
    },
  });

export const updateWikiPage = (filePath, payload, repoSlug = null) =>
  invoke("update_wiki_page", {
    filePath,
    repo: repoSlug || null,
    title: payload.title,
    tags: payload.tags ?? [],
    status: payload.status ?? null,
    body: payload.body ?? null,
  });

export const reindexWiki = (repoSlug = null) =>
  invoke("reindex_wiki", { repo: repoSlug || null });

export const archiveWikiPage = (filePath, reason, repoSlug = null) =>
  invoke("archive_wiki_page", {
    repo: repoSlug || null,
    payload: { file_path: filePath, reason: reason || "" },
  });

export const archiveWikiPages = (filePaths, reason, repoSlug = null) =>
  invoke("archive_wiki_pages", {
    repo: repoSlug || null,
    payload: { file_paths: filePaths, reason: reason || "" },
  });

export const restoreWikiPage = (filePath, repoSlug = null) =>
  invoke("restore_wiki_page", {
    repo: repoSlug || null,
    payload: { file_path: filePath },
  });

export const restoreWikiPages = (filePaths, repoSlug = null) =>
  invoke("restore_wiki_pages", {
    repo: repoSlug || null,
    payload: { file_paths: filePaths },
  });

export const restoreWikiFolder = (directoryPath, repoSlug = null) =>
  invoke("restore_wiki_folder", {
    repo: repoSlug || null,
    payload: { directory_path: directoryPath },
  });

export const archiveWikiFolder = (directoryPath, reason, repoSlug = null) =>
  invoke("archive_wiki_folder", {
    repo: repoSlug || null,
    payload: { directory_path: directoryPath, reason: reason || "" },
  });

export const deleteWikiPage = (filePath, repoSlug = null) =>
  invoke("delete_wiki_page", { filePath, repo: repoSlug || null });

export const deleteWikiFolder = (folderPath, repoSlug = null) =>
  invoke("delete_wiki_folder", {
    payload: { folder_path: folderPath, repo: repoSlug || undefined },
  });

export const deleteActiveWikiFolder = (folderPath, repoSlug = null) =>
  invoke("delete_active_wiki_folder", {
    payload: { folder_path: folderPath, repo: repoSlug || undefined },
  });

export const moveWikiPage = (filePath, targetFolder, repoSlug = null) =>
  invoke("move_wiki_page", {
    payload: {
      file_path: filePath,
      target_folder: targetFolder,
      repo: repoSlug || undefined,
    },
  });

export const moveWikiPages = (filePaths, targetFolder, repoSlug = null) =>
  invoke("move_wiki_pages", {
    payload: {
      file_paths: filePaths,
      target_folder: targetFolder,
      repo: repoSlug || undefined,
    },
  });

