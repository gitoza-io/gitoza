//! Crash recovery for confirm workflow steps and push-failure rollback.

use std::path::Path;

use anyhow::Result;
use sync_git::run::{git_run, git_stdout};

use crate::rebase::{abort_rebase_impl, is_rebase_in_progress};
use crate::store::{PushFailedStore, WorkflowStore};
use crate::types::WorkflowStep;

pub fn push_fail_reason(output: &str) -> String {
    let out = output.to_lowercase();
    if out.contains("timeout") || out.contains("timed out") {
        return "timeout".to_string();
    }
    if out.contains("rejected")
        || out.contains("non-fast-forward")
        || out.contains("failed to push")
    {
        return "conflict".to_string();
    }
    "network".to_string()
}

/// Undo the confirm commit when push failed; clear workflow state; mark push failed.
///
/// Caller must already hold the repo git lock.
pub async fn recover_after_push_failed(
    repo_path: &Path,
    work_branch: &str,
    workflow: &dyn WorkflowStore,
    push_failed: &dyn PushFailedStore,
    push_output: &str,
) {
    let origin_ref = format!("origin/{work_branch}");
    let head_sha = git_stdout(repo_path, &["rev-parse", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string());
    let remote_sha = git_stdout(repo_path, &["rev-parse", "--verify", origin_ref.as_str()])
        .await
        .ok()
        .map(|s| s.trim().to_string());
    let should_reset = match (head_sha.as_deref(), remote_sha.as_deref()) {
        (Some(h), Some(r)) => h != r,
        _ => true,
    };
    if should_reset {
        let _ = git_run(repo_path, &["reset", "--mixed", "HEAD~1"]).await;
    }
    let _ = workflow.clear();
    let reason = push_fail_reason(push_output);
    let _ = push_failed.mark(&reason);
}

/// Recover after crash / restart based on persisted workflow step.
///
/// Caller must already hold the repo git lock.
pub async fn check_and_recover(
    repo_path: &Path,
    workflow: &dyn WorkflowStore,
) -> Result<()> {
    let Some(step) = workflow.get_step()? else {
        return Ok(());
    };

    if is_rebase_in_progress(repo_path).await.unwrap_or(false) {
        let _ = abort_rebase_impl(repo_path).await;
        let _ = workflow.clear();
        return Ok(());
    }

    match step {
        WorkflowStep::Staged => {
            let _ = git_run(repo_path, &["reset"]).await; // unstage only
        }
        WorkflowStep::Committed | WorkflowStep::RebaseDone => {
            let _ = git_run(repo_path, &["reset", "--mixed", "HEAD~1"]).await;
        }
    }
    let _ = workflow.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MemoryWorkflowStore;
    use std::fs;
    use std::process::Command;

    fn git(cwd: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        git(dir, &["init"]);
        git(dir, &["config", "user.name", "Tester"]);
        git(dir, &["config", "user.email", "tester@example.com"]);
        fs::write(dir.join("a.txt"), "v1\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-m", "init"]);
    }

    #[tokio::test]
    async fn recover_staged_unstages_only() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        init_repo(&repo);
        fs::write(repo.join("a.txt"), "dirty\n").unwrap();
        git(&repo, &["add", "a.txt"]);

        let store = MemoryWorkflowStore::default();
        store.set_step(WorkflowStep::Staged, "gitoza").unwrap();
        check_and_recover(&repo, &store).await.unwrap();

        assert!(store.get_step().unwrap().is_none());
        let status = Command::new("git")
            .current_dir(&repo)
            .args(["status", "--porcelain"])
            .output()
            .unwrap();
        let s = String::from_utf8_lossy(&status.stdout);
        // Unstaged modification remains.
        assert!(s.contains("a.txt"), "{s}");
        assert!(!s.starts_with("M  "), "should not be fully staged: {s}");
    }

    #[tokio::test]
    async fn recover_committed_resets_mixed() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        init_repo(&repo);
        fs::write(repo.join("a.txt"), "v2\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "local"]);

        let parent = Command::new("git")
            .current_dir(&repo)
            .args(["rev-parse", "HEAD~1"])
            .output()
            .unwrap();
        let parent_sha = String::from_utf8_lossy(&parent.stdout).trim().to_string();

        let store = MemoryWorkflowStore::default();
        store.set_step(WorkflowStep::Committed, "gitoza").unwrap();
        check_and_recover(&repo, &store).await.unwrap();

        assert!(store.get_step().unwrap().is_none());
        let head = Command::new("git")
            .current_dir(&repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        let head_sha = String::from_utf8_lossy(&head.stdout).trim().to_string();
        assert_eq!(head_sha, parent_sha);
        assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "v2\n");
    }

    #[test]
    fn push_fail_reason_classifies() {
        assert_eq!(push_fail_reason("operation timed out"), "timeout");
        assert_eq!(push_fail_reason("! [rejected] non-fast-forward"), "conflict");
        assert_eq!(push_fail_reason("Could not resolve host"), "network");
    }

    #[tokio::test]
    async fn recover_aborts_rebase_in_progress() {
        use crate::rebase::is_rebase_in_progress;
        use crate::store::MemoryPushFailedStore;
        use crate::test_git::{clone_other, engine, git, head_sha, setup_with_origin};
        use crate::PublishOutcome;

        let tmp = tempfile::tempdir().unwrap();
        let (work, bare) = setup_with_origin(tmp.path());
        let other = tmp.path().join("other");
        clone_other(&bare, &other);
        fs::write(other.join("f.txt"), "remote\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-m", "remote edit"]);
        git(&other, &["push", "origin", "gitoza"]);

        let pre_publish = head_sha(&work);
        fs::write(work.join("f.txt"), "mine\n").unwrap();

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);
        match engine.publish("sync: mine").await.expect("publish") {
            PublishOutcome::Conflict { .. } => {}
            other => panic!("expected Conflict, got {other:?}"),
        }
        assert_eq!(
            workflow.get_step().unwrap(),
            Some(WorkflowStep::Committed)
        );
        assert!(
            is_rebase_in_progress(&work).await.unwrap(),
            "rebase should be paused on conflict"
        );

        check_and_recover(&work, &workflow).await.unwrap();

        assert!(workflow.get_step().unwrap().is_none());
        assert!(!is_rebase_in_progress(&work).await.unwrap());
        assert_eq!(head_sha(&work), pre_publish);
        assert_eq!(fs::read_to_string(work.join("f.txt")).unwrap(), "mine\n");
    }
}
