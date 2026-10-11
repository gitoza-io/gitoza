//! Tauri IPC command wrappers delegating to `gitoza_rust_backend::ipc_api`.

#![allow(clippy::too_many_arguments)]

use gitoza_rust_backend::models::*;

type AppStateHandle<'a> = tauri::State<'a, std::sync::Arc<gitoza_rust_backend::AppState>>;

#[tauri::command]
pub async fn get_repo_connection(
    state: AppStateHandle<'_>,
) -> Result<gitoza_rust_backend::models::RepoConnectionResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_repo_connection(&**state).await
}

#[tauri::command]
pub async fn list_repos(
    state: AppStateHandle<'_>,
) -> Result<gitoza_rust_backend::models::ReposListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_repos(&**state).await
}

#[tauri::command]
pub async fn delete_repo(
    state: AppStateHandle<'_>,
    slug: String,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_repo(&**state, slug).await
}

#[tauri::command]
pub async fn quick_sync_repo(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::QuickSyncResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::quick_sync_repo(&**state, repo).await
}

#[tauri::command]
pub async fn index_from_git_status(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::IndexFromGitStatusResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::index_from_git_status(&**state, repo).await
}

#[tauri::command]
pub async fn get_ssh_status() -> Result<gitoza_rust_backend::models::SshStatusResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_ssh_status().await
}

#[tauri::command]
pub async fn connect_repo(
    state: AppStateHandle<'_>,
    payload: ConnectRepoRequest,
) -> Result<gitoza_rust_backend::models::ConnectRepoResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::connect_repo(&**state, payload).await
}

#[tauri::command]
pub async fn create_playground(
    state: AppStateHandle<'_>,
) -> Result<gitoza_rust_backend::models::ConnectRepoResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_playground(&**state).await
}

#[tauri::command]
pub async fn playground_save_changes(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::PlaygroundSaveResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::playground_save_changes(&**state, repo).await
}

#[tauri::command]
pub async fn create_project(
    state: AppStateHandle<'_>,
    payload: CreateProjectRequest,
) -> Result<gitoza_rust_backend::models::CreateProjectResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_project(&**state, payload).await
}

#[tauri::command]
pub async fn delete_project(
    state: AppStateHandle<'_>,
    payload: DeleteProjectRequest,
) -> Result<gitoza_rust_backend::models::DeleteProjectResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_project(&**state, payload).await
}

#[tauri::command]
pub async fn create_folder(
    state: AppStateHandle<'_>,
    payload: CreateFolderRequest,
) -> Result<gitoza_rust_backend::models::CreateFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_folder(&**state, payload).await
}

#[tauri::command]
pub async fn rename_folder(
    state: AppStateHandle<'_>,
    payload: RenameFolderRequest,
) -> Result<gitoza_rust_backend::models::RenameFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::rename_folder(&**state, payload).await
}

#[tauri::command]
pub async fn delete_folder(
    state: AppStateHandle<'_>,
    payload: DeleteFolderRequest,
) -> Result<gitoza_rust_backend::models::DeleteFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_folder(&**state, payload).await
}

#[tauri::command]
pub async fn create_case(
    state: AppStateHandle<'_>,
    payload: CreateTestCaseRequest,
) -> Result<gitoza_rust_backend::models::CreateTestCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_case(&**state, payload).await
}

#[tauri::command]
pub async fn batch_create_cases(
    state: AppStateHandle<'_>,
    payload: BatchCreateTestCasesRequest,
) -> Result<gitoza_rust_backend::models::BatchCreateTestCasesResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::batch_create_cases(&**state, payload).await
}

#[tauri::command]
pub async fn rename_case(
    state: AppStateHandle<'_>,
    payload: RenameCaseRequest,
) -> Result<gitoza_rust_backend::models::RenameCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::rename_case(&**state, payload).await
}

#[tauri::command]
pub async fn move_case(
    state: AppStateHandle<'_>,
    payload: MoveCaseRequest,
) -> Result<gitoza_rust_backend::models::MoveCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::move_case(&**state, payload).await
}

#[tauri::command]
pub async fn delete_case(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_case(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn approve_case(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
    payload: ApproveCaseRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::approve_case(&**state, file_path, repo, payload).await
}

#[tauri::command]
pub async fn archive_case(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveCaseRequest,
) -> Result<gitoza_rust_backend::models::ArchiveCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_case(&**state, repo, payload).await
}

#[tauri::command]
pub async fn archive_cases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveCasesRequest,
) -> Result<gitoza_rust_backend::models::ArchiveCasesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_cases(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_case(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreCaseRequest,
) -> Result<gitoza_rust_backend::models::RestoreCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_case(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_cases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreCasesRequest,
) -> Result<gitoza_rust_backend::models::RestoreCasesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_cases(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_folder(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreFolderRequest,
) -> Result<gitoza_rust_backend::models::RestoreFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_folder(&**state, repo, payload).await
}

#[tauri::command]
pub async fn archive_folder(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveFolderRequest,
) -> Result<gitoza_rust_backend::models::ArchiveFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_folder(&**state, repo, payload).await
}

#[tauri::command]
pub async fn reindex_cases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    stamp_external: Option<bool>,
) -> Result<Vec<gitoza_rust_backend::models::YamlIndexStats>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::reindex_cases(&**state, repo, stamp_external).await
}

#[tauri::command]
pub async fn get_repo_status(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    sync: Option<bool>,
) -> Result<gitoza_rust_backend::models::RepoStatusResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_repo_status(&**state, repo, sync).await
}

#[tauri::command]
pub async fn get_project_test_config(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::ProjectTestConfigResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_project_test_config(&**state, repo).await
}

#[tauri::command]
pub async fn set_project_test_config(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: SetProjectTestConfigRequest,
) -> Result<gitoza_rust_backend::models::ProjectTestConfigResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::set_project_test_config(&**state, repo, payload).await
}

#[tauri::command]
pub async fn set_project_feature_flags(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: SetProjectFeatureFlagsRequest,
) -> Result<gitoza_rust_backend::models::ProjectFeatureFlagsResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::set_project_feature_flags(&**state, repo, payload).await
}

#[tauri::command]
pub async fn get_project_sync_config(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::ProjectSyncConfigResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_project_sync_config(&**state, repo).await
}

#[tauri::command]
pub async fn set_project_sync_config(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    provider_type: String,
    local_assets_path: Option<String>,
    s3_bucket: Option<String>,
    s3_region: Option<String>,
    s3_prefix: Option<String>,
    s3_endpoint: Option<String>,
    access_key_id: Option<String>,
    secret_access_key: Option<String>,
) -> Result<gitoza_rust_backend::models::ProjectSyncConfigResponse, gitoza_rust_backend::ApiError> {
    let payload = SetProjectSyncConfigRequest {
        provider_type,
        local_assets_path,
        s3_bucket,
        s3_region,
        s3_prefix,
        s3_endpoint,
        access_key_id,
        secret_access_key,
    };
    gitoza_rust_backend::ipc_api::set_project_sync_config(&**state, repo, payload).await
}

#[tauri::command]
pub async fn verify_and_resolve_s3_state(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    activate: Option<bool>,
) -> Result<gitoza_rust_backend::models::S3VerifyResolveResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::verify_and_resolve_s3_state(&**state, repo, activate).await
}

#[tauri::command]
pub async fn link_repo_to_global_s3_profile(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::S3VerifyResolveResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::link_repo_to_global_s3_profile(&**state, repo).await
}

#[tauri::command]
pub async fn probe_global_s3_onboarding(
    state: AppStateHandle<'_>,
) -> Result<
    gitoza_rust_backend::models::ProbeGlobalS3OnboardingResponse,
    gitoza_rust_backend::ApiError,
> {
    gitoza_rust_backend::ipc_api::probe_global_s3_onboarding(&**state).await
}

#[tauri::command]
pub async fn get_dashboard_summary(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::DashboardSummaryResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_dashboard_summary(&**state, repo).await
}

#[tauri::command]
pub async fn get_repository_tree(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    project: Option<String>,
    folder_prefix: Option<String>,
    depth: Option<String>,
    archive_mode: Option<bool>,
) -> Result<Vec<gitoza_rust_backend::models::RepositoryTreeNode>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_repository_tree(
        &**state,
        repo,
        project,
        folder_prefix,
        depth,
        archive_mode,
    )
    .await
}

#[tauri::command]
pub async fn list_cases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    search: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    tag: Option<String>,
    directory: Option<String>,
    directories: Option<String>,
    path_prefix: Option<String>,
    approve_status: Option<String>,
    updated_by: Option<String>,
    assigned_to: Option<String>,
    requirement_id: Option<String>,
    automated: Option<bool>,
    param_filters: Option<String>,
    include_archived: Option<bool>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::YamlCaseListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_cases(
        &**state,
        repo,
        search,
        status,
        priority,
        tag,
        directory,
        directories,
        path_prefix,
        approve_status,
        updated_by,
        assigned_to,
        requirement_id,
        automated,
        param_filters,
        include_archived,
        sort_by,
        sort_dir,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn search_run_cases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    priority: Option<String>,
    requirement_id: Option<String>,
    executed_by: Option<String>,
    assigned_to: Option<String>,
    automated: Option<bool>,
    result: Option<String>,
    include_archived: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::RunCaseListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::search_run_cases(
        &**state,
        repo,
        search,
        tag,
        priority,
        requirement_id,
        executed_by,
        assigned_to,
        automated,
        result,
        include_archived,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn get_run_case_filters(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::RunCaseFilters, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run_case_filters(&**state, repo).await
}

#[tauri::command]
pub async fn get_case_filters(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseFilters, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_case_filters(&**state, repo).await
}

#[tauri::command]
pub async fn get_case_detail(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_case_detail(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn update_case(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: String,
    priority: String,
    body: Option<String>,
    requirement_ids: Option<Vec<String>>,
    assigned_to: Option<String>,
    params: Option<std::collections::BTreeMap<String, String>>,
    automated: Option<bool>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::update_case(
        &**state,
        file_path,
        repo,
        title,
        tags,
        status,
        priority,
        body,
        requirement_ids,
        assigned_to,
        params,
        automated,
    )
    .await
}

#[tauri::command]
pub async fn link_case_requirement(
    state: AppStateHandle<'_>,
    file_path: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::link_case_requirement(&**state, file_path, ticket_id, repo).await
}

#[tauri::command]
pub async fn unlink_case_requirement(
    state: AppStateHandle<'_>,
    file_path: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::unlink_case_requirement(&**state, file_path, ticket_id, repo)
        .await
}

#[tauri::command]
pub async fn save_test_asset(
    state: AppStateHandle<'_>,
    project_id: String,
    file_name: String,
    file_bytes: Vec<u8>,
) -> Result<String, String> {
    gitoza_rust_backend::ipc_api::save_test_asset(&**state, project_id, file_name, file_bytes).await
}

#[tauri::command]
pub async fn sync_pending_assets(
    state: AppStateHandle<'_>,
    project_id: String,
) -> Result<gitoza_rust_backend::models::SyncPendingAssetsResponse, String> {
    gitoza_rust_backend::ipc_api::sync_pending_assets(&**state, project_id).await
}

#[tauri::command]
pub async fn resolve_and_load_asset(
    state: AppStateHandle<'_>,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    gitoza_rust_backend::ipc_api::resolve_and_load_asset(&**state, project_id, file_name).await
}

#[tauri::command]
pub async fn delete_local_asset(
    state: AppStateHandle<'_>,
    project_id: String,
    file_name: String,
) -> Result<(), String> {
    gitoza_rust_backend::ipc_api::delete_local_asset(&**state, project_id, file_name).await
}

#[tauri::command]
pub async fn sync_automation_executions(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::AutomationSyncResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::sync_automation_executions(&**state, repo).await
}

#[tauri::command]
pub async fn list_automation_pipelines(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<Vec<gitoza_rust_backend::models::AutomationPipelineListItem>, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::list_automation_pipelines(&**state, repo).await
}

#[tauri::command]
pub async fn list_automation_executions(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    pipeline_name: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<gitoza_rust_backend::models::AutomationExecutionListItem>, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::list_automation_executions(
        &**state,
        repo,
        pipeline_name,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn get_automation_execution(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    execution_id: String,
) -> Result<gitoza_rust_backend::models::AutomationExecutionDetailResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_automation_execution(&**state, repo, execution_id).await
}

#[tauri::command]
pub async fn list_automation_results(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    execution_id: String,
    suite_key: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::AutomationResultListResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::list_automation_results(
        &**state,
        repo,
        execution_id,
        suite_key,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn list_automation_suites(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    execution_id: String,
) -> Result<gitoza_rust_backend::models::AutomationSuiteListResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::list_automation_suites(&**state, repo, execution_id).await
}

#[tauri::command]
pub async fn get_automation_result_detail(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    execution_id: String,
    case_key: Option<String>,
    junit_file: Option<String>,
    classname: Option<String>,
    name: Option<String>,
) -> Result<gitoza_rust_backend::models::AutomationResultDetailResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_automation_result_detail(
        &**state,
        repo,
        execution_id,
        case_key,
        junit_file,
        classname,
        name,
    )
    .await
}

#[tauri::command]
pub async fn post_case_comment(
    state: AppStateHandle<'_>,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::post_case_comment(&**state, file_path, text, repo).await
}

#[tauri::command]
pub async fn delete_case_comment(
    state: AppStateHandle<'_>,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_case_comment(&**state, file_path, index, repo).await
}

#[tauri::command]
pub async fn get_git_user_name(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_git_user_name(&**state, repo).await
}

#[tauri::command]
pub async fn get_git_profile(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::GitProfileResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_git_profile(&**state, repo).await
}

#[tauri::command]
pub async fn set_git_profile(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: gitoza_rust_backend::models::SetGitProfileRequest,
) -> Result<gitoza_rust_backend::models::GitProfileResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::set_git_profile(&**state, repo, payload).await
}

#[tauri::command]
pub async fn sync_git_user_cache(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::sync_git_user_cache(&**state, repo).await
}

#[tauri::command]
pub async fn list_case_templates(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::CaseTemplateListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_case_templates(&**state, repo).await
}

#[tauri::command]
pub async fn get_case_template_content(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    file_path: String,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_case_template_content(&**state, repo, file_path).await
}

#[tauri::command]
pub async fn save_case_template(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: SaveCaseTemplateRequest,
) -> Result<gitoza_rust_backend::models::SaveCaseTemplateResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::save_case_template(&**state, repo, payload).await
}

#[tauri::command]
pub async fn capture_pending_changes(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::capture_pending_changes(&**state, repo).await
}

#[tauri::command]
pub async fn clear_pending_changes(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    unstage: bool,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::clear_pending_changes(&**state, repo, unstage).await
}

#[tauri::command]
pub async fn discard_pending_paths(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: DiscardPendingPathsRequest,
) -> Result<gitoza_rust_backend::models::WorkflowDiffFilesResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::discard_pending_paths(&**state, repo, payload).await
}

#[tauri::command]
pub async fn get_pending_diff_files(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::WorkflowDiffFilesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_pending_diff_files(&**state, repo).await
}

#[tauri::command]
pub async fn get_pending_diff_content(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    file_path: String,
) -> Result<gitoza_rust_backend::models::WorkflowDiffContentResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_pending_diff_content(&**state, repo, file_path).await
}

#[tauri::command]
pub async fn workflow_ensure_draft(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::WorkflowEnsureDraftResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::workflow_ensure_draft(&**state, repo).await
}

#[tauri::command]
pub async fn workflow_push_failed_status(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::PushFailedStatusResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::workflow_push_failed_status(&**state, repo).await
}

#[tauri::command]
pub async fn confirm_changes(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::WorkflowConfirmResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::confirm_changes(&**state, repo).await
}

#[tauri::command]
pub async fn resolve_rebase(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ResolveRebaseRequest,
) -> Result<gitoza_rust_backend::models::WorkflowConfirmResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::resolve_rebase(&**state, repo, payload).await
}

#[tauri::command]
pub async fn abort_rebase(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::abort_rebase(&**state, repo).await
}

#[tauri::command]
pub async fn recover_confirm_workflow(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::recover_confirm_workflow(&**state, repo).await
}

#[tauri::command]
pub async fn prefetch_repo(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::prefetch_repo(&**state, repo).await
}

#[tauri::command]
pub async fn create_run(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: CreateRunRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_run(&**state, repo, payload).await
}

#[tauri::command]
pub async fn list_runs(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    include_archived: Option<bool>,
    archived_only: Option<bool>,
    search: Option<String>,
    approve_status: Option<String>,
    requirement_id: Option<String>,
    requirement_ids: Option<Vec<String>>,
    release: Option<String>,
) -> Result<Vec<gitoza_rust_backend::models::RunListItem>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_runs(
        &**state,
        repo,
        include_archived,
        archived_only,
        search,
        approve_status,
        requirement_id,
        requirement_ids,
        release,
    )
    .await
}

#[tauri::command]
pub async fn get_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    include_cases: Option<bool>,
    include_case_comments: Option<bool>,
) -> Result<gitoza_rust_backend::models::RunDetailResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run(
        &**state,
        run_id,
        repo,
        include_cases,
        include_case_comments,
    )
    .await
}

#[tauri::command]
pub async fn list_run_cases(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    folder_prefix: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::RunCaseListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_run_cases(
        &**state,
        run_id,
        repo,
        folder_prefix,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn list_run_case_paths(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::RunCasePathsResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_run_case_paths(&**state, run_id, repo).await
}

#[tauri::command]
pub async fn get_run_folder_tree(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    folder_prefix: Option<String>,
    depth: Option<String>,
) -> Result<Vec<gitoza_rust_backend::models::RunFolderTreeNode>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run_folder_tree(
        &**state,
        run_id,
        repo,
        folder_prefix,
        depth,
    )
    .await
}

#[tauri::command]
pub async fn get_run_case_comments(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run_case_comments(&**state, run_id, file_path, repo).await
}

#[tauri::command]
pub async fn get_run_breakdown(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::RunBreakdownResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run_breakdown(&**state, run_id, repo).await
}

#[tauri::command]
pub async fn get_project_case_breakdown(
    state: AppStateHandle<'_>,
    project_path: String,
    repo: Option<String>,
) -> Result<
    gitoza_rust_backend::models::ProjectCaseBreakdownResponse,
    gitoza_rust_backend::ApiError,
> {
    gitoza_rust_backend::ipc_api::get_project_case_breakdown(&**state, project_path, repo).await
}

#[tauri::command]
pub async fn get_run_case_content(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlCaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_run_case_content(&**state, run_id, file_path, repo).await
}

#[tauri::command]
pub async fn patch_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    payload: PatchRunRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::patch_run(&**state, run_id, repo, payload).await
}

#[tauri::command]
pub async fn link_run_requirement(
    state: AppStateHandle<'_>,
    run_id: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::link_run_requirement(&**state, run_id, ticket_id, repo).await
}

#[tauri::command]
pub async fn unlink_run_requirement(
    state: AppStateHandle<'_>,
    run_id: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::unlink_run_requirement(&**state, run_id, ticket_id, repo).await
}

#[tauri::command]
pub async fn patch_run_case(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    repo: Option<String>,
    payload: gitoza_rust_backend::models::PatchRunCaseRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::patch_run_case(&**state, run_id, file_path, repo, payload).await
}

#[tauri::command]
pub async fn get_workspace_usernames(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::WorkspaceUsernames, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_workspace_usernames(&**state, repo).await
}

#[tauri::command]
pub async fn approve_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    payload: ApproveRunRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::approve_run(&**state, run_id, repo, payload).await
}

#[tauri::command]
pub async fn duplicate_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    payload: DuplicateRunRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::duplicate_run(&**state, run_id, repo, payload).await
}

#[tauri::command]
pub async fn add_run_cases(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    payload: AddRunCasesRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::add_run_cases(&**state, run_id, repo, payload).await
}

#[tauri::command]
pub async fn remove_run_cases(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    file_paths: Option<Vec<String>>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::remove_run_cases(&**state, run_id, repo, file_paths).await
}

#[tauri::command]
pub async fn post_run_comment(
    state: AppStateHandle<'_>,
    run_id: String,
    text: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::post_run_comment(&**state, run_id, text, repo).await
}

#[tauri::command]
pub async fn post_run_case_comment(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::post_run_case_comment(&**state, run_id, file_path, text, repo)
        .await
}

#[tauri::command]
pub async fn delete_run_comment(
    state: AppStateHandle<'_>,
    run_id: String,
    index: usize,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_run_comment(&**state, run_id, index, repo).await
}

#[tauri::command]
pub async fn delete_run_case_comment(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_run_case_comment(&**state, run_id, file_path, index, repo)
        .await
}

#[tauri::command]
pub async fn set_run_result(
    state: AppStateHandle<'_>,
    run_id: String,
    file_path: String,
    repo: Option<String>,
    payload: SetRunResultRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::set_run_result(&**state, run_id, file_path, repo, payload).await
}

#[tauri::command]
pub async fn set_run_results_batch(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
    payload: SetRunResultsBatchRequest,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::set_run_results_batch(&**state, run_id, repo, payload).await
}

#[tauri::command]
pub async fn flush_pending_run_yaml(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::flush_pending_run_yaml(&**state, repo).await
}

#[tauri::command]
pub async fn delete_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_run(&**state, run_id, repo).await
}

#[tauri::command]
pub async fn restore_run(
    state: AppStateHandle<'_>,
    run_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_run(&**state, run_id, repo).await
}

#[tauri::command]
pub async fn ensure_baseline_sync(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::ensure_baseline_sync(&**state, repo).await
}

#[tauri::command]
pub async fn export_cases_pdf(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ExportCasesPdfRequest,
) -> Result<Vec<u8>, gitoza_rust_backend::ApiError> {
    if payload.cases.is_empty() {
        return Err(gitoza_rust_backend::ApiError::bad_request(
            "At least one test case is required for PDF export.",
        ));
    }

    let repo_slug = repo.unwrap_or_default();
    let repo_path = gitoza_rust_backend::resolve_repo_path(&**state, Some(&repo_slug)).ok();
    let bytes = gitoza_rust_backend::pdf_export::generate_pdf_for_cases(
        &**state,
        &repo_slug,
        repo_path.as_deref(),
        payload.cases,
        payload.toc,
    )
    .await;
    if bytes.is_empty() {
        return Err(gitoza_rust_backend::ApiError::internal(
            "Failed to render Typst PDF for the selected test cases.",
        ));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn export_runs_pdf(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ExportRunsPdfRequest,
) -> Result<Vec<u8>, gitoza_rust_backend::ApiError> {
    if payload.runs.is_empty() {
        return Err(gitoza_rust_backend::ApiError::bad_request(
            "At least one test run is required for PDF export.",
        ));
    }
    if payload.runs.iter().all(|run| run.cases.is_empty()) {
        return Err(gitoza_rust_backend::ApiError::bad_request(
            "At least one test case is required across selected runs for PDF export.",
        ));
    }

    let repo_slug = repo.unwrap_or_default();
    let repo_path = gitoza_rust_backend::resolve_repo_path(&**state, Some(&repo_slug)).ok();
    let bytes = gitoza_rust_backend::pdf_export::generate_pdf_for_runs(
        &**state,
        &repo_slug,
        repo_path.as_deref(),
        payload.runs,
    )
    .await;
    if bytes.is_empty() {
        return Err(gitoza_rust_backend::ApiError::internal(
            "Failed to render Typst PDF for the selected test runs.",
        ));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_tickets(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    search: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    ticket_type: Option<String>,
    tag: Option<String>,
    assigned_to: Option<String>,
    sprint: Option<String>,
    release: Option<String>,
    project: Option<String>,
    parent: Option<String>,
    ticket_id: Option<String>,
    param_filters: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::YamlTicketListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_tickets(
        &**state,
        repo,
        search,
        status,
        priority,
        ticket_type,
        tag,
        assigned_to,
        sprint,
        release,
        project,
        parent,
        ticket_id,
        param_filters,
        sort_by,
        sort_dir,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn get_ticket_filters(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlTicketFilters, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_ticket_filters(&**state, repo).await
}

#[tauri::command]
pub async fn get_ticket_detail(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlTicketDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_ticket_detail(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn list_ticket_projects(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    archived_only: Option<bool>,
) -> Result<Vec<gitoza_rust_backend::models::RepositoryTreeNode>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_ticket_projects(&**state, repo, archived_only).await
}

#[tauri::command]
pub async fn create_ticket_project(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::CreateTicketProjectRequest,
) -> Result<gitoza_rust_backend::models::CreateTicketProjectResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::create_ticket_project(&**state, payload).await
}

#[tauri::command]
pub async fn get_ticket_project(
    state: AppStateHandle<'_>,
    project_name: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::TicketProjectDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_ticket_project(&**state, project_name, repo).await
}

#[tauri::command]
pub async fn update_ticket_project(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::UpdateTicketProjectRequest,
) -> Result<gitoza_rust_backend::models::TicketProjectDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::update_ticket_project(&**state, payload).await
}

#[tauri::command]
pub async fn get_ticket_project_breakdown(
    state: AppStateHandle<'_>,
    project_name: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::TicketProjectBreakdownResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_ticket_project_breakdown(&**state, project_name, repo).await
}

#[tauri::command]
pub async fn get_release_ticket_breakdown(
    state: AppStateHandle<'_>,
    release_id: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::TicketProjectBreakdownResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::get_release_ticket_breakdown(&**state, release_id, repo).await
}

#[tauri::command]
pub async fn set_ticket_project_archived(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::SetTicketProjectArchivedRequest,
) -> Result<gitoza_rust_backend::models::TicketProjectMutationResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::set_ticket_project_archived(&**state, payload).await
}

#[tauri::command]
pub async fn delete_ticket_project(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::DeleteTicketProjectRequest,
) -> Result<gitoza_rust_backend::models::TicketProjectMutationResponse, gitoza_rust_backend::ApiError>
{
    gitoza_rust_backend::ipc_api::delete_ticket_project(&**state, payload).await
}

#[tauri::command]
pub async fn create_ticket(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::CreateTicketRequest,
) -> Result<gitoza_rust_backend::models::CreateTicketResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_ticket(&**state, payload).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_ticket(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: String,
    priority: String,
    ticket_type: Option<String>,
    body: Option<String>,
    assigned_to: Option<String>,
    sprint: Option<String>,
    release: Option<String>,
    parent: Option<String>,
    params: Option<std::collections::BTreeMap<String, String>>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::update_ticket(
        &**state,
        file_path,
        repo,
        title,
        tags,
        status,
        priority,
        ticket_type,
        body,
        assigned_to,
        sprint,
        release,
        parent,
        params,
    )
    .await
}

#[tauri::command]
pub async fn rename_ticket(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::RenameTicketRequest,
) -> Result<gitoza_rust_backend::models::RenameTicketResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::rename_ticket(&**state, payload).await
}

#[tauri::command]
pub async fn post_ticket_comment(
    state: AppStateHandle<'_>,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlTicketDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::post_ticket_comment(&**state, file_path, text, repo).await
}

#[tauri::command]
pub async fn delete_ticket_comment(
    state: AppStateHandle<'_>,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlTicketDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_ticket_comment(&**state, file_path, index, repo).await
}

#[tauri::command]
pub async fn reindex_tickets(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlIndexStats, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::reindex_tickets(&**state, repo).await
}

#[tauri::command]
pub async fn list_releases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    search: Option<String>,
    project: Option<String>,
    project_empty: Option<bool>,
    release_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<gitoza_rust_backend::models::YamlReleaseListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_releases(
        &**state,
        repo,
        search,
        project,
        project_empty,
        release_id,
        status,
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn get_release_filters(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlReleaseFilters, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_release_filters(&**state, repo).await
}

#[tauri::command]
pub async fn get_release_detail(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlReleaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_release_detail(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn create_release(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::CreateReleaseRequest,
) -> Result<gitoza_rust_backend::models::CreateReleaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_release(&**state, payload).await
}

#[tauri::command]
pub async fn update_release(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
    name: String,
    project: Option<String>,
    status: Option<String>,
    body: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlReleaseDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::update_release(
        &**state, file_path, repo, name, project, status, body,
    )
    .await
}

#[tauri::command]
pub async fn reindex_releases(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlIndexStats, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::reindex_releases(&**state, repo).await
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_wiki_pages(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    status: Option<String>,
    folder: Option<String>,
    page_id: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_archived: Option<bool>,
    archived_only: Option<bool>,
) -> Result<gitoza_rust_backend::models::YamlWikiPageListResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::list_wiki_pages(
        &**state,
        repo,
        search,
        tag,
        status,
        folder,
        page_id,
        sort_by,
        sort_dir,
        limit,
        offset,
        include_archived,
        archived_only,
    )
    .await
}

#[tauri::command]
pub async fn get_wiki_filters(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlWikiFilters, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_wiki_filters(&**state, repo).await
}

#[tauri::command]
pub async fn get_wiki_page_detail(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlWikiPageDetail, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_wiki_page_detail(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn get_wiki_tree(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    archive_mode: Option<bool>,
) -> Result<Vec<gitoza_rust_backend::models::RepositoryTreeNode>, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::get_wiki_tree(&**state, repo, archive_mode).await
}

#[tauri::command]
pub async fn create_wiki_folder(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::CreateWikiFolderRequest,
) -> Result<gitoza_rust_backend::models::CreateWikiFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_wiki_folder(&**state, payload).await
}

#[tauri::command]
pub async fn create_wiki_page(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::CreateWikiPageRequest,
) -> Result<gitoza_rust_backend::models::CreateWikiPageResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::create_wiki_page(&**state, payload).await
}

#[tauri::command]
pub async fn update_wiki_page(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: Option<String>,
    body: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::update_wiki_page(&**state, file_path, repo, title, tags, status, body)
        .await
}

#[tauri::command]
pub async fn reindex_wiki(
    state: AppStateHandle<'_>,
    repo: Option<String>,
) -> Result<gitoza_rust_backend::models::YamlIndexStats, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::reindex_wiki(&**state, repo).await
}

#[tauri::command]
pub async fn move_wiki_page(
    state: AppStateHandle<'_>,
    payload: MoveCaseRequest,
) -> Result<gitoza_rust_backend::models::MoveCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::move_wiki_page(&**state, payload).await
}

#[tauri::command]
pub async fn move_wiki_pages(
    state: AppStateHandle<'_>,
    payload: gitoza_rust_backend::models::MoveWikiPagesRequest,
) -> Result<gitoza_rust_backend::models::MoveWikiPagesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::move_wiki_pages(&**state, payload).await
}

#[tauri::command]
pub async fn archive_wiki_page(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveCaseRequest,
) -> Result<gitoza_rust_backend::models::ArchiveCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_wiki_page(&**state, repo, payload).await
}

#[tauri::command]
pub async fn archive_wiki_pages(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveCasesRequest,
) -> Result<gitoza_rust_backend::models::ArchiveCasesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_wiki_pages(&**state, repo, payload).await
}

#[tauri::command]
pub async fn archive_wiki_folder(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: ArchiveFolderRequest,
) -> Result<gitoza_rust_backend::models::ArchiveFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::archive_wiki_folder(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_wiki_page(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreCaseRequest,
) -> Result<gitoza_rust_backend::models::RestoreCaseResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_wiki_page(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_wiki_pages(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreCasesRequest,
) -> Result<gitoza_rust_backend::models::RestoreCasesResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_wiki_pages(&**state, repo, payload).await
}

#[tauri::command]
pub async fn restore_wiki_folder(
    state: AppStateHandle<'_>,
    repo: Option<String>,
    payload: RestoreFolderRequest,
) -> Result<gitoza_rust_backend::models::RestoreFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::restore_wiki_folder(&**state, repo, payload).await
}

#[tauri::command]
pub async fn delete_wiki_page(
    state: AppStateHandle<'_>,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_wiki_page(&**state, file_path, repo).await
}

#[tauri::command]
pub async fn delete_wiki_folder(
    state: AppStateHandle<'_>,
    payload: DeleteFolderRequest,
) -> Result<gitoza_rust_backend::models::DeleteFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_wiki_folder(&**state, payload).await
}

#[tauri::command]
pub async fn delete_active_wiki_folder(
    state: AppStateHandle<'_>,
    payload: DeleteFolderRequest,
) -> Result<gitoza_rust_backend::models::DeleteFolderResponse, gitoza_rust_backend::ApiError> {
    gitoza_rust_backend::ipc_api::delete_active_wiki_folder(&**state, payload).await
}