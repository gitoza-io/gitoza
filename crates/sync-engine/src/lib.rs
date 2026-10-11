//! Single-branch sync workflow: publish (commit → rebase → push), recover, conflicts.
//!
//! Product IPC, SQLite, and indexing stay in the host (Gitoza). Inject branch name and
//! [`WorkflowStore`] / [`PushFailedStore`] adapters.

pub mod conflict;
pub mod modify_delete;
pub mod publish;
pub mod rebase;
pub mod recover;
pub mod store;
pub mod types;

#[cfg(test)]
mod test_git;

pub use conflict::{
    classify_conflict, parse_ls_files_unmerged, primary_paths_for_conflicts, stage_paths_for_content,
    ConflictClassification, PathStages, RenameGroup,
};
pub use modify_delete::{
    normalize_modify_delete_intent, resolve_modify_delete_intent, validate_modify_delete_intent,
};
pub use publish::SyncEngine;
pub use rebase::{
    abort_rebase_impl, apply_rename_resolution, continue_rebase_until_done, is_rebase_in_progress,
    is_safe_repo_relative_path, read_conflicts, RebaseContinueResult,
};
pub use recover::{check_and_recover, recover_after_push_failed, push_fail_reason};
pub use store::{PushFailedStore, WorkflowStore};
pub use types::{
    ConflictFile, ConflictResolution, PublishError, PublishOutcome, WorkflowStep,
};
