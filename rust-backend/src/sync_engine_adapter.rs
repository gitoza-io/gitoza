//! Adapters from Gitoza SQLite / models onto `sync_engine` traits.

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use rusqlite::Connection;
use sync_engine::{
    ConflictFile, ConflictResolution, PublishError, PublishOutcome, PushFailedStore, WorkflowStep,
    WorkflowStore,
};

use crate::models::{ConflictFileContent, ResolveRebaseFileItem, WorkflowConfirmResponse};
use crate::{
    clear_confirm_workflow_state_db, clear_push_failed_db, get_confirm_workflow_step_db,
    mark_push_failed_db, set_confirm_workflow_state_db, ApiError, AppState,
};

pub struct SqliteWorkflowStore {
    conn: Arc<Mutex<Connection>>,
    slug: String,
}

impl SqliteWorkflowStore {
    pub fn new(conn: Arc<Mutex<Connection>>, slug: String) -> Self {
        Self { conn, slug }
    }
}

impl WorkflowStore for SqliteWorkflowStore {
    fn get_step(&self) -> Result<Option<WorkflowStep>> {
        let conn = self.conn.lock().unwrap();
        Ok(get_confirm_workflow_step_db(&conn, &self.slug).and_then(|s| WorkflowStep::parse(&s)))
    }

    fn set_step(&self, step: WorkflowStep, branch: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        set_confirm_workflow_state_db(&conn, &self.slug, step.as_str(), branch, None)
    }

    fn clear(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        clear_confirm_workflow_state_db(&conn, &self.slug)
    }
}

pub struct SqlitePushFailedStore {
    conn: Arc<Mutex<Connection>>,
    slug: String,
}

impl SqlitePushFailedStore {
    pub fn new(conn: Arc<Mutex<Connection>>, slug: String) -> Self {
        Self { conn, slug }
    }
}

impl PushFailedStore for SqlitePushFailedStore {
    fn mark(&self, reason: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        mark_push_failed_db(&conn, &self.slug, reason)
    }

    fn clear(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        clear_push_failed_db(&conn, &self.slug)
    }
}

pub struct NoopWorkflowStore;

impl WorkflowStore for NoopWorkflowStore {
    fn get_step(&self) -> Result<Option<WorkflowStep>> {
        Ok(None)
    }
    fn set_step(&self, _step: WorkflowStep, _branch: &str) -> Result<()> {
        Ok(())
    }
    fn clear(&self) -> Result<()> {
        Ok(())
    }
}

pub struct NoopPushFailedStore;

impl PushFailedStore for NoopPushFailedStore {
    fn mark(&self, _reason: &str) -> Result<()> {
        Ok(())
    }
    fn clear(&self) -> Result<()> {
        Ok(())
    }
}

pub fn conflict_file_to_model(c: ConflictFile) -> ConflictFileContent {
    ConflictFileContent {
        file_path: c.file_path,
        content: c.content,
        conflict_kind: c.conflict_kind,
        shared_deleted: c.shared_deleted,
        your_content: c.your_content,
        shared_content: c.shared_content,
        your_path: c.your_path,
        shared_path: c.shared_path,
        base_path: c.base_path,
        has_content_conflict: c.has_content_conflict,
        related_paths: c.related_paths,
    }
}

pub fn resolve_item_to_engine(rf: ResolveRebaseFileItem) -> ConflictResolution {
    ConflictResolution {
        file_path: rf.file_path,
        content: rf.content,
        conflict_kind: rf.conflict_kind,
        action: rf.action,
        shared_deleted: rf.shared_deleted,
        new_path: rf.new_path,
        chosen_path: rf.chosen_path,
        related_paths: rf.related_paths,
    }
}

pub fn map_publish_error(e: PublishError) -> ApiError {
    match e {
        PublishError::BadRequest(m) => ApiError::bad_request(m),
        PublishError::Internal(m) => ApiError::internal(m),
    }
}

pub async fn map_publish_outcome(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
    outcome: PublishOutcome,
    success_message: &str,
) -> Result<WorkflowConfirmResponse, ApiError> {
    match outcome {
        PublishOutcome::Published { pre_rebase_sha } => {
            if !pre_rebase_sha.is_empty() {
                let _ =
                    crate::sync_index_since_commit(state, repo_path, slug, &pre_rebase_sha).await;
            }
            let _ = crate::broadcast_refresh(state).await;
            Ok(WorkflowConfirmResponse {
                success: true,
                message: success_message.to_string(),
                conflict_files: None,
                conflict: false,
                conflict_file_contents: None,
                push_failed_due_to_remote: false,
                push_failed_reason: None,
            })
        }
        PublishOutcome::NothingToCommit => Ok(WorkflowConfirmResponse {
            success: false,
            message: "Nothing to commit.".to_string(),
            conflict_files: None,
            conflict: false,
            conflict_file_contents: None,
            push_failed_due_to_remote: false,
            push_failed_reason: None,
        }),
        PublishOutcome::Conflict {
            files,
            contents,
            message,
        } => {
            let mapped: Vec<_> = contents.into_iter().map(conflict_file_to_model).collect();
            Err(ApiError::conflict_with_files(message, mapped, Some(files)))
        }
        PublishOutcome::PushFailed {
            message,
            reason,
            pre_rebase_sha,
        } => {
            if !pre_rebase_sha.is_empty() {
                let _ =
                    crate::sync_index_since_commit(state, repo_path, slug, &pre_rebase_sha).await;
                let _ = crate::broadcast_refresh(state).await;
            }
            Ok(WorkflowConfirmResponse {
                success: false,
                message,
                conflict_files: None,
                conflict: false,
                conflict_file_contents: None,
                push_failed_due_to_remote: true,
                push_failed_reason: Some(reason),
            })
        }
        PublishOutcome::Failed { message } => Ok(WorkflowConfirmResponse {
            success: false,
            message,
            conflict_files: None,
            conflict: false,
            conflict_file_contents: None,
            push_failed_due_to_remote: false,
            push_failed_reason: None,
        }),
    }
}

pub fn make_stores(
    state: &AppState,
    slug: &str,
) -> (Box<dyn WorkflowStore>, Box<dyn PushFailedStore>) {
    match crate::open_repo_db(state, slug) {
        Ok(conn) => (
            Box::new(SqliteWorkflowStore::new(conn.clone(), slug.to_string())),
            Box::new(SqlitePushFailedStore::new(conn, slug.to_string())),
        ),
        Err(_) => (Box::new(NoopWorkflowStore), Box::new(NoopPushFailedStore)),
    }
}
