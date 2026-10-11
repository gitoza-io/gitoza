//! Shared request/response shapes for the HTTP API (`lib.rs` handlers use these types for `Json` responses).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

fn default_ok() -> String {
    "ok".to_string()
}

fn default_draft() -> String {
    "draft".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Comment {
    pub author: String,
    pub timestamp: String,
    pub text: String,
}

fn default_baseline() -> String {
    "baseline".to_string()
}

fn default_folder_type() -> String {
    "folder".to_string()
}

fn default_not_started() -> String {
    "not_started".to_string()
}

fn default_false() -> bool {
    false
}

fn default_true() -> bool {
    true
}

fn default_remote_git_kind() -> String {
    crate::workspace::WORKSPACE_KIND_REMOTE_GIT.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetProjectTestConfigRequest {
    pub enable_review_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTestConfigResponse {
    pub enable_review_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetProjectFeatureFlagsRequest {
    pub enable_review_system: bool,
    #[serde(default)]
    pub modules: crate::project_sync_config::ProjectModules,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFeatureFlagsResponse {
    pub enable_review_system: bool,
    pub modules: crate::project_sync_config::ProjectModules,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSyncConfigResponse {
    #[serde(alias = "providerType")]
    pub provider_type: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "localAssetsPath"
    )]
    pub local_assets_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Bucket")]
    pub s3_bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Region")]
    pub s3_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Prefix")]
    pub s3_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Endpoint")]
    pub s3_endpoint: Option<String>,
    #[serde(alias = "awsCredentialsConfigured")]
    pub aws_credentials_configured: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "credentialsStorage"
    )]
    pub credentials_storage: Option<String>,
}

pub use crate::sync_secrets::GlobalS3Blueprint;

#[derive(Debug, Clone, Serialize)]
pub struct PendingAssetFailure {
    #[serde(alias = "fileName")]
    pub file_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPendingAssetsResponse {
    pub skipped: bool,
    #[serde(alias = "uploadedCount")]
    pub uploaded_count: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failed: Vec<PendingAssetFailure>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeGlobalS3OnboardingResponse {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none", alias = "globalBlueprint")]
    pub global_blueprint: Option<GlobalS3Blueprint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum S3VerifyResolveResponse {
    Skipped,
    Active {
        config: ProjectSyncConfigResponse,
        #[serde(alias = "autoConfigured")]
        auto_configured: bool,
    },
    ExpiredCredentials {
        message: String,
        config: ProjectSyncConfigResponse,
    },
    BucketMismatch {
        message: String,
        config: ProjectSyncConfigResponse,
        #[serde(alias = "globalBlueprint")]
        global_blueprint: GlobalS3Blueprint,
    },
    NeedsSetup {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", alias = "globalBlueprint")]
        global_blueprint: Option<GlobalS3Blueprint>,
    },
    /// Blank repo + global blueprint on disk; user must confirm before repo write.
    GlobalProfileAvailable {
        #[serde(alias = "globalBlueprint")]
        global_blueprint: GlobalS3Blueprint,
        #[serde(alias = "awsCredentialsConfigured")]
        aws_credentials_configured: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetProjectSyncConfigRequest {
    #[serde(alias = "providerType")]
    pub provider_type: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "localAssetsPath"
    )]
    pub local_assets_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Bucket")]
    pub s3_bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Region")]
    pub s3_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Prefix")]
    pub s3_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "s3Endpoint")]
    pub s3_endpoint: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "accessKeyId"
    )]
    pub access_key_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "secretAccessKey"
    )]
    pub secret_access_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatusResponse {
    pub is_valid_repo: bool,
    pub repo_path: String,
    pub current_branch: Option<String>,
    pub last_commit_hash: Option<String>,
    pub last_commit_message: Option<String>,
    pub last_commit_author: Option<String>,
    pub last_commit_date: Option<String>,
    pub is_dirty: bool,

    #[serde(default = "default_baseline")]
    pub workplace_mode: String,
    #[serde(default)]
    pub case_files_dirty: bool,
    #[serde(default)]
    pub run_files_dirty: bool,
    #[serde(default)]
    pub run_yaml_pending: bool,
    #[serde(default = "default_false")]
    pub push_failed_due_to_remote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push_failed_reason: Option<String>,

    #[serde(default = "default_true")]
    pub enable_review_system: bool,

    #[serde(default)]
    pub modules: crate::project_sync_config::ProjectModules,

    #[serde(default = "default_remote_git_kind")]
    pub workspace_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEnsureDraftResponse {
    pub branch: String,
    pub created: bool,
}

fn default_conflict_kind() -> String {
    "content".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictFileContent {
    pub file_path: String,
    pub content: String,
    #[serde(default = "default_conflict_kind")]
    pub conflict_kind: String,
    #[serde(default)]
    pub shared_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub your_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub your_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_path: Option<String>,
    #[serde(default)]
    pub has_content_conflict: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveRebaseFileItem {
    pub file_path: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default = "default_conflict_kind")]
    pub conflict_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default)]
    pub shared_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowConfirmResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_files: Option<Vec<String>>,
    #[serde(default)]
    pub conflict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_file_contents: Option<Vec<ConflictFileContent>>,
    #[serde(default)]
    pub push_failed_due_to_remote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push_failed_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushFailedStatusResponse {
    pub push_failed_due_to_remote: bool,
    pub push_failed_reason: Option<String>,
}

/// Response for `POST /api/repo/index-from-git-status` (incremental index from `git status --porcelain`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexFromGitStatusResponse {
    pub status: String,
    pub porcelain_paths: usize,
    pub case_paths: usize,
    pub run_paths: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingFileChange {
    pub path: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDiffFilesResponse {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub changes: Vec<PendingFileChange>,
}

/// Request for `discard_pending_paths` (Confirm Changes discard / reset).
#[derive(Debug, Clone, Deserialize)]
pub struct DiscardPendingPathsRequest {
    pub paths: Vec<String>,
    /// Optional status hints (A/M/R/D). Backend merges with live staged name-status.
    #[serde(default)]
    pub changes: Vec<PendingFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDiffContentResponse {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseTemplateItem {
    pub file_path: String,
    pub stem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseTemplateListResponse {
    pub items: Vec<CaseTemplateItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveCaseTemplateRequest {
    pub name: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveCaseTemplateResponse {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveRebaseRequest {
    pub resolved_files: Vec<ResolveRebaseFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConnectionResponse {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoListItem {
    pub slug: String,
    pub display_name: String,
    pub repo_path: String,
    #[serde(default)]
    pub total_test_cases: i64,
    #[serde(default)]
    pub total_suites: i64,
    pub last_sync: Option<String>,
    #[serde(default = "default_remote_git_kind")]
    pub workspace_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReposListResponse {
    pub repos: Vec<RepoListItem>,
    pub default_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetGitProfileRequest {
    #[serde(default, alias = "globalUserName")]
    pub global_user_name: Option<String>,
    #[serde(default, alias = "globalUserEmail")]
    pub global_user_email: Option<String>,
    #[serde(default, alias = "localUserName")]
    pub local_user_name: Option<String>,
    #[serde(default, alias = "localUserEmail")]
    pub local_user_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitProfileResponse {
    #[serde(alias = "globalUserName")]
    pub global_user_name: Option<String>,
    #[serde(alias = "globalUserEmail")]
    pub global_user_email: Option<String>,
    #[serde(alias = "localUserName")]
    pub local_user_name: Option<String>,
    #[serde(alias = "localUserEmail")]
    pub local_user_email: Option<String>,
    #[serde(alias = "effectiveUserName")]
    pub effective_user_name: Option<String>,
    #[serde(alias = "effectiveUserEmail")]
    pub effective_user_email: Option<String>,
    #[serde(alias = "cachedUserName")]
    pub cached_user_name: Option<String>,
    #[serde(alias = "cachedUserEmail")]
    pub cached_user_email: Option<String>,
    #[serde(alias = "hasLocalOverride")]
    pub has_local_override: bool,
    #[serde(alias = "reposSynced")]
    pub repos_synced: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRepoRequest {
    #[serde(default = "default_true_https")]
    pub connection_type: String,
    pub remote_url: String,
    #[serde(default = "default_gitoza_work_branch")]
    pub branch: String,
    #[serde(default)]
    pub personal_access_token: Option<String>,
}

fn default_true_https() -> String {
    "https".to_string()
}

fn default_gitoza_work_branch() -> String {
    crate::paths::GITOZA_WORK_BRANCH.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshStatusResponse {
    pub system_key_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRepoResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default = "default_repo_cloned_msg")]
    pub message: String,
    pub repo_path: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaygroundSaveResponse {
    pub success: bool,
    pub message: String,
}

fn default_repo_cloned_msg() -> String {
    "Repository cloned successfully.".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickSyncResponse {
    pub status: String,
    #[serde(default)]
    pub pulled: i64,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardGlobalStats {
    pub total_test_cases: i64,
    pub total_projects: i64,
    pub high_priority_focus: i64,
    pub automated_count: i64,
    pub last_repository_sync: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardProjectLastActivity {
    pub timestamp: Option<String>,
    pub author: Option<String>,
}

impl Default for DashboardProjectLastActivity {
    fn default() -> Self {
        Self {
            timestamp: None,
            author: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardProjectDetail {
    pub project_name: String,
    pub project_path: String,
    pub suite_count: i64,
    pub total_test_cases: i64,
    pub automated_count: i64,
    pub project_priority_distribution: BTreeMap<String, i64>,
    pub last_activity: DashboardProjectLastActivity,
    #[serde(default)]
    pub test_suites: Vec<Value>,

    // Mirrors Pydantic computed_field outputs.
    #[serde(default)]
    pub aggregated_priority: BTreeMap<String, i64>,
    #[serde(default)]
    pub latest_activity: DashboardProjectLastActivity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummaryResponse {
    pub global_stats: DashboardGlobalStats,
    pub projects: Vec<DashboardProjectDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryTreeNode {
    #[serde(rename = "type", default = "default_folder_type")]
    pub type_: String,
    pub name: String,
    pub display_name: String,
    #[serde(default)]
    pub children: Option<Vec<RepositoryTreeNode>>,
    pub directory_path: Option<String>,
    pub path_from_root: Option<Vec<String>>,
    #[serde(default)]
    pub is_project: bool,
    #[serde(default)]
    pub case_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlCaseListItem {
    pub case_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub file_path: String,
    pub repo_slug: String,
    pub directory: Option<String>,
    pub indexed_at: Option<String>,
    #[serde(default = "default_draft")]
    pub approve_status: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    pub assigned_to: Option<String>,
    #[serde(default)]
    pub automated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlCaseListResponse {
    pub total: i64,
    pub items: Vec<YamlCaseListItem>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlCaseDetail {
    pub case_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub file_path: String,
    #[serde(default)]
    pub body: String,
    /// Full file text; not sent over IPC (avoids duplicating markdown in `body`).
    #[serde(default, skip_serializing)]
    pub raw: String,
    #[serde(default = "default_draft")]
    pub approve_status: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    pub assigned_to: Option<String>,
    #[serde(default)]
    pub automated: bool,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApproveStatus {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproveCaseRequest {
    pub approve_status: ApproveStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveCaseRequest {
    pub file_path: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveCaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveCasesRequest {
    pub file_paths: Vec<String>,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveCasesResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub archived_paths: Vec<String>,
    #[serde(default)]
    pub failed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreCaseRequest {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreCaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreCasesRequest {
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreCasesResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub restored_paths: Vec<String>,
    #[serde(default)]
    pub failed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreFolderRequest {
    pub directory_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub restored_paths: Vec<String>,
    #[serde(default)]
    pub failed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFolderRequest {
    pub directory_path: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub archived_paths: Vec<String>,
    #[serde(default)]
    pub failed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlIndexStats {
    pub repo_slug: String,
    #[serde(default)]
    pub indexed: i64,
    #[serde(default)]
    pub errors: i64,
    #[serde(default)]
    pub removed: i64,
    #[serde(default)]
    pub directories: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlCaseFilters {
    #[serde(default)]
    pub statuses: Vec<String>,
    #[serde(default)]
    pub priorities: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub directories: Vec<String>,
    #[serde(default)]
    pub assigned_to: Vec<String>,
    #[serde(default)]
    pub updated_by: Vec<String>,
    #[serde(default)]
    pub param_keys: Vec<String>,
    #[serde(default)]
    pub param_values_by_key: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceUsernames {
    #[serde(default)]
    pub usernames: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCaseFilters {
    #[serde(default)]
    pub priorities: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    #[serde(default)]
    pub executed_by: Vec<String>,
    #[serde(default)]
    pub assigned_to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCaseListResponse {
    pub total: i64,
    pub items: Vec<RunCaseItem>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCasePathsResponse {
    pub total: i64,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFolderResultStats {
    pub total_cases: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub pending: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunFolderTreeNode {
    pub name: String,
    pub display_name: String,
    pub directory_path: String,
    #[serde(default)]
    pub is_project: bool,
    #[serde(default)]
    pub case_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_stats: Option<RunFolderResultStats>,
    #[serde(default)]
    pub children: Vec<RunFolderTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub project_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub project_name: String,
    pub project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTestCaseRequest {
    pub case_id: String,
    pub title: String,
    #[serde(default = "default_medium_priority")]
    pub priority: String,
    #[serde(default = "default_active_status")]
    pub status: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    /// Legacy single id; merged into `requirement_ids` on create.
    #[serde(default)]
    pub requirement_id: String,
    #[serde(default)]
    pub assigned_to: String,
    #[serde(default)]
    pub automated: bool,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    pub directory: String,
    #[serde(default)]
    pub target_folder: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
}

fn default_medium_priority() -> String {
    "medium".to_string()
}

fn default_active_status() -> String {
    "active".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameFolderRequest {
    pub folder_path: String,
    pub new_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameCaseRequest {
    pub file_path: String,
    pub new_case_id: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameCaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub old_path: String,
    pub new_path: String,
    pub case_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveCaseRequest {
    pub file_path: String,
    pub target_folder: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveCaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveWikiPagesRequest {
    pub file_paths: Vec<String>,
    pub target_folder: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveWikiPagesResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub moved: Vec<MoveCaseResponse>,
    #[serde(default)]
    pub failed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub parent_path: String,
    pub folder_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteFolderRequest {
    pub folder_path: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteProjectRequest {
    pub directory_path: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteProjectResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub directory_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTestCaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub file_path: String,
    pub case_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCreateTestCasesRequest {
    #[serde(default)]
    pub repo: Option<String>,
    pub cases: Vec<CreateTestCaseRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCreateFailure {
    pub index: usize,
    #[serde(default)]
    pub case_id: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCreateTestCasesResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    #[serde(default)]
    pub created_count: i64,
    #[serde(default)]
    pub results: Vec<CreateTestCaseResponse>,
    #[serde(default)]
    pub failures: Vec<BatchCreateFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRunRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cases: Option<Vec<BTreeMap<String, String>>>,
    /// Optional release_id (`project/stem`) this run is executed against.
    #[serde(default)]
    pub release: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateRunRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchRunRequest {
    #[serde(default)]
    pub archived: Option<bool>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub assigned_to: Option<String>,
    /// When set, replaces the run-level ticket coverage list (empty clears).
    #[serde(default)]
    pub requirement_ids: Option<Vec<String>>,
    /// When set, replaces the linked release_id (empty string clears).
    #[serde(default)]
    pub release: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchRunCaseRequest {
    #[serde(default)]
    pub assigned_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproveRunRequest {
    pub approve_status: ApproveStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunListItem {
    pub id: i64,
    pub run_id: String,
    pub repo_slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub updated_by: Option<String>,
    #[serde(default)]
    pub total_cases: i64,
    #[serde(default)]
    pub passed: i64,
    #[serde(default)]
    pub failed: i64,
    #[serde(default)]
    pub skipped: i64,
    #[serde(default = "default_not_started")]
    pub status: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default = "default_draft")]
    pub approve_status: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub assigned_to: Option<String>,
    /// Ticket ids this run covers (YAML `requirement_ids` / SQLite JSON).
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    /// Optional release_id (`project/stem`) this run is executed against.
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCaseItem {
    pub id: i64,
    pub run_id: String,
    pub file_path: String,
    pub case_id: String,
    pub title: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub requirement_ids: Vec<String>,
    #[serde(default)]
    pub automated: bool,
    pub result: Option<String>,
    pub executed_at: Option<String>,
    pub comment: Option<String>,
    pub executed_by: Option<String>,
    pub assigned_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_assigned_to: Option<String>,
    #[serde(default)]
    pub directory: String,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetailResponse {
    pub run: RunListItem,
    pub cases: Vec<RunCaseItem>,
}

/// Pass/fail/skip/pending counts for Dashboard breakdown sections.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownStats {
    pub total_cases: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub pending: i64,
}

/// One suite/project row in Dashboard breakdown (flat list with breadcrumb label).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SuiteBreakdownRow {
    pub key: String,
    pub label: String,
    pub stats: BreakdownStats,
}

/// Pre-aggregated run breakdown for Dashboard (DB-only, no per-case payload).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunBreakdownResponse {
    pub by_priority: BTreeMap<String, BreakdownStats>,
    pub by_suite: Vec<SuiteBreakdownRow>,
    pub tags: Vec<String>,
    pub by_tag: BTreeMap<String, BreakdownStats>,
}

/// Pre-aggregated project case breakdown for Dashboard Case tab (DB-only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectCaseBreakdownResponse {
    pub total_cases: i64,
    pub automated_count: i64,
    pub untagged_count: i64,
    pub by_priority: BTreeMap<String, i64>,
    pub tags: Vec<String>,
    pub by_tag: BTreeMap<String, i64>,
    pub by_user: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRunCasesRequest {
    pub cases: Vec<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRunResultRequest {
    pub result: String,
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResultItem {
    pub file_path: String,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRunResultsBatchRequest {
    pub results: Vec<RunResultItem>,
}

/// Stamped case row returned after DB-first result write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResultCaseStamp {
    pub file_path: String,
    pub result: String,
    pub executed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Run header fields returned after DB-first result write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResultHeaderPatch {
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRunResultsBatchResponse {
    pub status: String,
    pub updated: usize,
    pub run: RunResultHeaderPatch,
    pub cases: Vec<RunResultCaseStamp>,
}

fn default_export_status() -> String {
    "approved".to_string()
}

fn default_export_priority() -> String {
    "high".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCaseTag {
    pub name: String,
    #[serde(default)]
    pub tone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCase {
    pub title: String,
    pub case_id: String,
    #[serde(default = "default_export_status")]
    pub status: String,
    #[serde(default = "default_export_priority")]
    pub priority: String,
    #[serde(default)]
    pub tags: Vec<TestCaseTag>,
    /// Breadcrumb from `file_path` (project > suite > …), same convention as `filePath2Breadcrumb` + `" > "`.
    #[serde(default)]
    pub path: String,
    /// Optional requirement / ticket id from YAML front matter.
    /// Accepts legacy aliases to keep PDF export robust across payload variants.
    #[serde(
        default,
        alias = "requirement",
        alias = "requirement_ticket",
        alias = "requirementId"
    )]
    pub requirement_id: String,
    /// Full Markdown body (same source as case detail view); rendered via Typst `cmarker`.
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportTocCase {
    pub case_index: usize,
    pub case_id: String,
    pub title: String,
    #[serde(default = "default_export_priority")]
    pub priority: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub result_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportTocNode {
    #[serde(default, rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub children: Vec<ExportTocNode>,
    #[serde(default)]
    pub cases: Vec<ExportTocCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportCasesPdfRequest {
    #[serde(default)]
    pub cases: Vec<TestCase>,
    #[serde(default)]
    pub toc: Vec<ExportTocNode>,
}

fn default_run_result_pending() -> String {
    "pending".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunPdfCase {
    pub title: String,
    pub case_id: String,
    #[serde(default = "default_run_result_pending")]
    pub result: String,
    #[serde(default = "default_export_priority")]
    pub priority: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub tags: Vec<TestCaseTag>,
    /// Breadcrumb from `file_path` (project > suite > …), same convention as case export.
    #[serde(default)]
    pub path: String,
    #[serde(
        default,
        alias = "requirement",
        alias = "requirement_ticket",
        alias = "requirementId"
    )]
    pub requirement_id: String,
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunPdfRun {
    #[serde(default, alias = "id", alias = "runId")]
    pub run_id: String,
    #[serde(default, alias = "name")]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_not_started")]
    pub status: String,
    #[serde(default)]
    pub total_cases: i64,
    #[serde(default)]
    pub passed: i64,
    #[serde(default)]
    pub failed: i64,
    #[serde(default)]
    pub skipped: i64,
    #[serde(default)]
    pub cases: Vec<TestRunPdfCase>,
    #[serde(default)]
    pub toc: Vec<ExportTocNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRunsPdfRequest {
    #[serde(default)]
    pub runs: Vec<TestRunPdfRun>,
}

// ── Test automation (CI JUnit ingest) ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationSyncResponse {
    pub discovered: u32,
    pub updated: u32,
    #[serde(default)]
    pub removed: u32,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationPipelineListItem {
    pub pipeline_name: String,
    pub execution_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_finished_at: Option<String>,
    pub failed_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationExecutionListItem {
    pub execution_id: String,
    pub pipeline_name: String,
    pub build_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    pub junit_file_count: i64,
    pub total: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub error: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationExecutionSummary {
    pub execution_id: String,
    pub pipeline_name: String,
    pub build_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ci_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggered_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    pub junit_file_count: i64,
    pub total: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub error: i64,
    pub status: String,
    pub remote_prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationJunitFileBreakdown {
    pub junit_file: String,
    pub total: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub error: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationExecutionDetailResponse {
    pub execution: AutomationExecutionSummary,
    pub junit_files: Vec<AutomationJunitFileBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationResultListItem {
    pub case_key: String,
    /// Alias for virtual case list compatibility.
    pub file_path: String,
    pub case_id: String,
    pub title: String,
    pub name: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub junit_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suite_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationResultListResponse {
    pub total: i64,
    pub items: Vec<AutomationResultListItem>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationSuiteListItem {
    pub suite_key: String,
    pub junit_file: String,
    pub suite_name: String,
    pub display_name: String,
    pub total: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub error: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationSuiteListResponse {
    pub items: Vec<AutomationSuiteListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationResultDetailResponse {
    pub case_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classname: Option<String>,
    pub name: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub junit_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_out: Option<String>,
}

// ---------------------------------------------------------------------------
// Tickets (Tasks)
// ---------------------------------------------------------------------------

fn default_ticket_type() -> String {
    "task".to_string()
}

fn default_ticket_status() -> String {
    "open".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlTicketListItem {
    pub ticket_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub file_path: String,
    pub repo_slug: String,
    pub indexed_at: Option<String>,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    pub assigned_to: Option<String>,
    pub reporter: Option<String>,
    pub sprint: Option<String>,
    pub release: Option<String>,
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlTicketListResponse {
    pub total: i64,
    pub items: Vec<YamlTicketListItem>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlTicketDetail {
    pub ticket_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub file_path: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing)]
    pub raw: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    pub assigned_to: Option<String>,
    pub reporter: Option<String>,
    pub sprint: Option<String>,
    pub release: Option<String>,
    pub parent: Option<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlTicketFilters {
    #[serde(default)]
    pub statuses: Vec<String>,
    #[serde(default)]
    pub priorities: Vec<String>,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub assigned_to: Vec<String>,
    #[serde(default)]
    pub sprints: Vec<String>,
    #[serde(default)]
    pub releases: Vec<String>,
    #[serde(default)]
    pub param_keys: Vec<String>,
    #[serde(default)]
    pub param_values_by_key: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTicketRequest {
    /// Optional; when empty the backend generates `{PREFIX}-{6 random}`.
    #[serde(default)]
    pub ticket_id: String,
    pub title: String,
    /// Ticket project folder under `.gitoza/tasks/tickets/{project}/`.
    pub project: String,
    #[serde(default = "default_medium_priority")]
    pub priority: String,
    #[serde(default = "default_ticket_status", rename = "status")]
    pub status: String,
    #[serde(default = "default_ticket_type", rename = "type")]
    pub ticket_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub assigned_to: String,
    #[serde(default)]
    pub reporter: String,
    #[serde(default)]
    pub sprint: String,
    #[serde(default)]
    pub release: String,
    #[serde(default)]
    pub parent: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTicketProjectRequest {
    pub project_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTicketProjectResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub project_name: String,
    pub project_path: String,
    #[serde(default)]
    pub ticket_prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketProjectDetail {
    pub project_name: String,
    #[serde(default)]
    pub ticket_prefix: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTicketProjectRequest {
    pub project_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TicketProjectBreakdownResponse {
    pub total: i64,
    #[serde(default)]
    pub by_status: BTreeMap<String, i64>,
    #[serde(default)]
    pub by_type: BTreeMap<String, i64>,
    #[serde(default)]
    pub backlog_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetTicketProjectArchivedRequest {
    pub project_name: String,
    pub archived: bool,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteTicketProjectRequest {
    pub project_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketProjectMutationResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTicketResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub file_path: String,
    pub ticket_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameTicketRequest {
    pub file_path: String,
    pub new_ticket_id: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameTicketResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub old_path: String,
    pub new_path: String,
    pub ticket_id: String,
}

// ---------------------------------------------------------------------------
// Ticket releases (`.gitoza/tasks/tickets/{project}/releases/`)
// release_id = `{project}/{stem}` (Option A); project is path-derived.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlReleaseListItem {
    pub release_id: String,
    pub name: Option<String>,
    pub project: Option<String>,
    pub status: Option<String>,
    pub file_path: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    /// Active (non-archived) tickets linked via ticket.release → release_id.
    #[serde(default)]
    pub ticket_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlReleaseListResponse {
    pub items: Vec<YamlReleaseListItem>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlReleaseDetail {
    pub release_id: String,
    pub name: Option<String>,
    pub project: Option<String>,
    pub status: Option<String>,
    pub file_path: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing)]
    pub raw: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlReleaseFilters {
    #[serde(default)]
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReleaseRequest {
    pub name: String,
    #[serde(default)]
    pub project: String,
    #[serde(default = "default_release_status")]
    pub status: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
}

fn default_release_status() -> String {
    "open".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReleaseResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub release_id: String,
    pub file_path: String,
}

// ---------------------------------------------------------------------------
// Wiki (`.gitoza/wiki/` nested folders + YAML pages)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlWikiPageListItem {
    pub page_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub folder: String,
    pub file_path: String,
    pub repo_slug: String,
    pub indexed_at: Option<String>,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlWikiPageListResponse {
    pub total: i64,
    pub items: Vec<YamlWikiPageListItem>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlWikiPageDetail {
    pub page_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub folder: String,
    pub file_path: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing)]
    pub raw: String,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YamlWikiFilters {
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWikiFolderRequest {
    pub parent_path: String,
    pub folder_name: String,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWikiFolderResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub folder_name: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWikiPageRequest {
    pub title: String,
    /// Folder path under `.gitoza/wiki/` (wiki root or any nested folder).
    pub folder: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWikiPageResponse {
    #[serde(default = "default_ok")]
    pub status: String,
    pub file_path: String,
    pub page_id: String,
}
