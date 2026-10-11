//! Confirm publish pipeline: fetch → add → commit → rebase → push.

use std::path::Path;
use std::sync::Arc;

use sync_git::run::{git_run, git_run_network, git_stdout};

use crate::modify_delete::resolve_modify_delete_intent;
use crate::rebase::{
    abort_rebase_impl, apply_rename_resolution, continue_rebase_until_done, is_rebase_in_progress,
    is_safe_repo_relative_path, read_conflicts, RebaseContinueResult,
};
use crate::recover::{check_and_recover, push_fail_reason, recover_after_push_failed};
use crate::store::{PushFailedStore, WorkflowStore};
use crate::types::{
    ConflictResolution, PublishError, PublishOutcome, WorkflowStep,
};

/// Background / quick-sync fetch budget (matches Gitoza clone `ls-remote` style).
pub const GIT_NETWORK_TIMEOUT_SECS: u64 = 90;

pub struct SyncEngine<'a> {
    pub repo_path: &'a Path,
    pub work_branch: &'a str,
    pub lock: Arc<tokio::sync::Mutex<()>>,
    pub workflow: &'a dyn WorkflowStore,
    pub push_failed: &'a dyn PushFailedStore,
}

impl SyncEngine<'_> {
    fn origin_ref(&self) -> String {
        format!("origin/{}", self.work_branch)
    }

    /// Crash recovery for persisted confirm steps. Acquires the repo lock.
    pub async fn recover(&self) -> anyhow::Result<()> {
        let _guard = self.lock.lock().await;
        check_and_recover(self.repo_path, self.workflow).await
    }

    /// Abort an in-progress rebase and clear workflow state. Acquires the repo lock.
    pub async fn abort_rebase(&self) -> anyhow::Result<()> {
        let _guard = self.lock.lock().await;
        abort_rebase_impl(self.repo_path).await?;
        let _ = self.workflow.clear();
        Ok(())
    }

    /// Confirm pipeline. Builds the commit message after `git add` via `build_message`.
    /// Acquires the repo lock.
    pub async fn publish_with_builder<F, Fut>(
        &self,
        build_message: F,
    ) -> Result<PublishOutcome, PublishError>
    where
        F: FnOnce(&Path) -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<Option<String>>>,
    {
        let _guard = self.lock.lock().await;
        self.publish_locked(build_message).await
    }

    /// Confirm with a fixed commit message (tests / callers that already know the message).
    pub async fn publish(&self, commit_message: &str) -> Result<PublishOutcome, PublishError> {
        let msg = commit_message.to_string();
        self.publish_with_builder(move |_| async move { Ok(Some(msg)) })
            .await
    }

    async fn publish_locked<F, Fut>(
        &self,
        build_message: F,
    ) -> Result<PublishOutcome, PublishError>
    where
        F: FnOnce(&Path) -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<Option<String>>>,
    {
        let _ = self
            .workflow
            .set_step(WorkflowStep::Staged, self.work_branch);

        if is_rebase_in_progress(self.repo_path)
            .await
            .unwrap_or(false)
        {
            let (files, contents) = read_conflicts(self.repo_path).await.unwrap_or_default();
            return Ok(PublishOutcome::Conflict {
                files,
                contents,
                message: "Confirm is paused because some changes still need your review."
                    .to_string(),
            });
        }

        // Best-effort fetch (same as Gitoza: ignore fetch errors and continue).
        let _ = sync_git::run::git_run_network_timeout(
            self.repo_path,
            &["fetch", "origin"],
            std::time::Duration::from_secs(GIT_NETWORK_TIMEOUT_SECS),
        )
        .await;

        let add_r = git_run(self.repo_path, &["add", "."])
            .await
            .map_err(|e| {
                let _ = self.workflow.clear();
                PublishError::Internal(format!("{e:#}"))
            })?;
        if !add_r.success {
            let _ = self.workflow.clear();
            return Err(PublishError::BadRequest(
                add_r.output.chars().take(500).collect(),
            ));
        }

        let msg = build_message(self.repo_path).await.map_err(|e| {
            let _ = self.workflow.clear();
            PublishError::Internal(format!("{e:#}"))
        })?;
        let Some(m) = msg else {
            let _ = self.workflow.clear();
            return Ok(PublishOutcome::NothingToCommit);
        };

        let commit_r = git_run(self.repo_path, &["commit", "-m", &m])
            .await
            .map_err(|e| {
                let _ = self.workflow.clear();
                PublishError::Internal(format!("{e:#}"))
            })?;
        if !commit_r.success {
            let _ = self.workflow.clear();
            return Err(PublishError::BadRequest(
                commit_r.output.chars().take(500).collect(),
            ));
        }

        let _ = self
            .workflow
            .set_step(WorkflowStep::Committed, self.work_branch);

        let origin_ref = self.origin_ref();
        let pre_rebase_sha = git_stdout(self.repo_path, &["rev-parse", "HEAD"])
            .await
            .unwrap_or_default()
            .trim()
            .to_string();
        let rebase = git_run(
            self.repo_path,
            &["rebase", "-Xfind-renames=100%", origin_ref.as_str()],
        )
        .await;
        match rebase {
            Ok(r) if r.success => {}
            Ok(r) => {
                if r.output.to_lowercase().contains("conflict") {
                    let (files, contents) =
                        read_conflicts(self.repo_path).await.unwrap_or_default();
                    return Ok(PublishOutcome::Conflict {
                        files,
                        contents,
                        message: "Someone else updated the same items. Choose which version to keep."
                            .to_string(),
                    });
                }
                let _ = git_run(self.repo_path, &["rebase", "--abort"]).await;
                let _ = self.workflow.clear();
                return Err(PublishError::BadRequest(
                    r.output.chars().take(500).collect(),
                ));
            }
            Err(e) => {
                let _ = self.workflow.clear();
                return Err(PublishError::Internal(format!("{e:#}")));
            }
        }

        let _ = self
            .workflow
            .set_step(WorkflowStep::RebaseDone, self.work_branch);

        self.push_after_rebase(pre_rebase_sha).await
    }

    async fn push_after_rebase(
        &self,
        pre_rebase_sha: String,
    ) -> Result<PublishOutcome, PublishError> {
        let push = git_run_network(
            self.repo_path,
            &["push", "origin", self.work_branch],
        )
        .await;
        match push {
            Ok(r) if r.success => {
                let _ = self.workflow.clear();
                let _ = self.push_failed.clear();
                Ok(PublishOutcome::Published { pre_rebase_sha })
            }
            Ok(r) => {
                recover_after_push_failed(
                    self.repo_path,
                    self.work_branch,
                    self.workflow,
                    self.push_failed,
                    &r.output,
                )
                .await;
                Ok(PublishOutcome::PushFailed {
                    message: r.output.chars().take(500).collect(),
                    reason: push_fail_reason(&r.output),
                    pre_rebase_sha,
                })
            }
            Err(e) => {
                let msg = format!("{e:#}");
                recover_after_push_failed(
                    self.repo_path,
                    self.work_branch,
                    self.workflow,
                    self.push_failed,
                    &msg,
                )
                .await;
                Ok(PublishOutcome::PushFailed {
                    message: msg.chars().take(500).collect(),
                    reason: push_fail_reason(&msg),
                    pre_rebase_sha,
                })
            }
        }
    }

    /// Apply conflict resolutions, continue rebase, push. Acquires the repo lock.
    pub async fn resolve_and_finish(
        &self,
        resolutions: &[ConflictResolution],
    ) -> Result<PublishOutcome, PublishError> {
        let _guard = self.lock.lock().await;

        for rf in resolutions {
            let p = rf.file_path.replace('\\', "/");
            if !is_safe_repo_relative_path(&p) {
                return Err(PublishError::BadRequest(format!("invalid path: {p}")));
            }

            let kind = if rf.conflict_kind.is_empty() {
                "content"
            } else {
                rf.conflict_kind.as_str()
            };

            match kind {
                "modify_delete" => {
                    let action = rf.action.as_deref().ok_or_else(|| {
                        PublishError::BadRequest(format!(
                            "modify_delete conflict for {p} requires action keep_mine, keep_both, or keep_theirs"
                        ))
                    })?;
                    if let Err(e) = resolve_modify_delete_intent(
                        self.repo_path,
                        &p,
                        rf.new_path.as_deref(),
                        rf.shared_deleted,
                        action,
                    )
                    .await
                    {
                        let msg = format!("{e:#}");
                        if msg.contains("unknown modify_delete intent")
                            || msg.contains("keep_both is only valid")
                        {
                            return Err(PublishError::BadRequest(msg));
                        }
                        return Err(PublishError::Internal(msg));
                    }
                }
                "rename" => {
                    let chosen = rf.chosen_path.as_deref().ok_or_else(|| {
                        PublishError::BadRequest(format!(
                            "rename conflict for {p} requires chosen_path"
                        ))
                    })?;
                    if !is_safe_repo_relative_path(chosen) {
                        return Err(PublishError::BadRequest(format!(
                            "invalid chosen_path: {chosen}"
                        )));
                    }
                    let content = rf.content.clone().unwrap_or_default();
                    let mut paths_to_remove = rf.related_paths.clone();
                    if !paths_to_remove.contains(&p) {
                        paths_to_remove.push(p.clone());
                    }
                    apply_rename_resolution(self.repo_path, chosen, &content, &paths_to_remove)
                        .await
                        .map_err(|e| {
                            PublishError::Internal(format!("rename resolve failed: {e:#}"))
                        })?;
                }
                "content" => {
                    let content = rf.content.clone().unwrap_or_default();
                    let full = self.repo_path.join(&p);
                    if let Some(parent) = full.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    tokio::fs::write(&full, &content)
                        .await
                        .map_err(|e| PublishError::Internal(format!("write {p} failed: {e}")))?;
                    let _ = git_run(self.repo_path, &["add", &p]).await;
                }
                "unknown" => {
                    return Err(PublishError::BadRequest(format!(
                        "cannot resolve unknown conflict kind for {p}"
                    )));
                }
                other => {
                    return Err(PublishError::BadRequest(format!(
                        "unsupported conflict kind {other} for {p}"
                    )));
                }
            }
        }

        let pre_rebase_sha = git_stdout(self.repo_path, &["rev-parse", "ORIG_HEAD"])
            .await
            .unwrap_or_default()
            .trim()
            .to_string();

        match continue_rebase_until_done(self.repo_path).await {
            Ok(RebaseContinueResult::Completed) => self.push_after_rebase(pre_rebase_sha).await,
            Ok(RebaseContinueResult::MoreConflicts(files, contents)) => {
                Ok(PublishOutcome::Conflict {
                    files,
                    contents,
                    message: "Someone else updated the same items. Choose which version to keep."
                        .to_string(),
                })
            }
            Ok(RebaseContinueResult::Failed(msg)) => Ok(PublishOutcome::Failed {
                message: msg.chars().take(500).collect(),
            }),
            Err(e) => Err(PublishError::Internal(format!("{e:#}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rebase::is_rebase_in_progress;
    use crate::store::{MemoryPushFailedStore, MemoryWorkflowStore};
    use crate::test_git::{
        clone_other, engine, git, setup_with_files, setup_with_origin,
    };
    use crate::types::ConflictResolution;
    use std::fs;

    fn expect_conflict(out: PublishOutcome) -> (Vec<String>, Vec<crate::types::ConflictFile>) {
        match out {
            PublishOutcome::Conflict { files, contents, .. } => (files, contents),
            other => panic!("expected Conflict, got {other:?}"),
        }
    }

    fn expect_published(out: PublishOutcome) {
        match out {
            PublishOutcome::Published { .. } => {}
            other => panic!("expected Published, got {other:?}"),
        }
    }

    fn content_resolution(file: &crate::types::ConflictFile, content: &str) -> ConflictResolution {
        ConflictResolution {
            file_path: file.file_path.clone(),
            content: Some(content.to_string()),
            conflict_kind: file.conflict_kind.clone(),
            action: None,
            shared_deleted: file.shared_deleted,
            new_path: None,
            chosen_path: None,
            related_paths: file.related_paths.clone(),
        }
    }

    #[tokio::test]
    async fn publish_happy_path_pushes_to_local_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let (work, _bare) = setup_with_origin(tmp.path());

        fs::write(work.join("f.txt"), "local\n").unwrap();

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);

        expect_published(engine.publish("sync: f.txt").await.expect("publish"));
        assert!(workflow.get_step().unwrap().is_none());
        assert!(push_failed.reason.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn publish_conflict_when_remote_diverged() {
        let tmp = tempfile::tempdir().unwrap();
        let (work, bare) = setup_with_origin(tmp.path());

        let other = tmp.path().join("other");
        clone_other(&bare, &other);
        fs::write(other.join("f.txt"), "remote\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-m", "remote edit"]);
        git(&other, &["push", "origin", "gitoza"]);

        fs::write(work.join("f.txt"), "mine\n").unwrap();

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);

        let (files, _) = expect_conflict(engine.publish("sync: mine").await.expect("publish"));
        assert!(
            files.iter().any(|f| f.contains("f.txt")),
            "files={files:?}"
        );
        assert_eq!(
            workflow.get_step().unwrap(),
            Some(WorkflowStep::Committed)
        );
    }

    #[tokio::test]
    async fn resolve_content_keep_mine_then_push() {
        let tmp = tempfile::tempdir().unwrap();
        let (work, bare) = setup_with_origin(tmp.path());

        let other = tmp.path().join("other");
        clone_other(&bare, &other);
        fs::write(other.join("f.txt"), "remote\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-m", "remote edit"]);
        git(&other, &["push", "origin", "gitoza"]);

        fs::write(work.join("f.txt"), "mine\n").unwrap();

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);

        let (files, contents) =
            expect_conflict(engine.publish("sync: mine").await.expect("publish"));
        assert!(files.iter().any(|f| f.contains("f.txt")), "files={files:?}");
        let file = contents
            .iter()
            .find(|c| c.file_path.contains("f.txt"))
            .expect("f.txt conflict");
        assert_eq!(file.conflict_kind, "content");

        let resolutions = vec![content_resolution(file, "mine\n")];
        expect_published(
            engine
                .resolve_and_finish(&resolutions)
                .await
                .expect("resolve"),
        );
        assert!(workflow.get_step().unwrap().is_none());
        assert!(!is_rebase_in_progress(&work).await.unwrap());
        assert_eq!(git(&work, &["show", "origin/gitoza:f.txt"]), "mine");
    }

    #[tokio::test]
    async fn resolve_modify_delete_keep_mine_then_push() {
        let tmp = tempfile::tempdir().unwrap();
        let (work, bare) = setup_with_origin(tmp.path());

        let other = tmp.path().join("other");
        clone_other(&bare, &other);
        git(&other, &["rm", "f.txt"]);
        git(&other, &["commit", "-m", "remote deleted"]);
        git(&other, &["push", "origin", "gitoza"]);

        fs::write(work.join("f.txt"), "mine\n").unwrap();

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);

        let (_, contents) = expect_conflict(engine.publish("sync: mine").await.expect("publish"));
        let file = contents
            .iter()
            .find(|c| c.file_path.contains("f.txt"))
            .unwrap_or_else(|| {
                panic!(
                    "expected f.txt modify_delete, got {:?}",
                    contents
                        .iter()
                        .map(|c| (&c.file_path, &c.conflict_kind, c.shared_deleted))
                        .collect::<Vec<_>>()
                )
            });
        assert_eq!(file.conflict_kind, "modify_delete");
        assert!(file.shared_deleted);

        let resolutions = vec![ConflictResolution {
            file_path: file.file_path.clone(),
            content: None,
            conflict_kind: "modify_delete".into(),
            action: Some("keep_mine".into()),
            shared_deleted: true,
            new_path: file.shared_path.clone(),
            chosen_path: None,
            related_paths: file.related_paths.clone(),
        }];
        expect_published(
            engine
                .resolve_and_finish(&resolutions)
                .await
                .expect("resolve"),
        );
        assert!(workflow.get_step().unwrap().is_none());
        assert_eq!(git(&work, &["show", "origin/gitoza:f.txt"]), "mine");
    }

    #[tokio::test]
    async fn resolve_rename_chosen_path_then_push() {
        let tmp = tempfile::tempdir().unwrap();
        let (work, bare) = setup_with_files(tmp.path(), &[("notes.md", "same body\n")]);

        let other = tmp.path().join("other");
        clone_other(&bare, &other);
        git(&other, &["mv", "notes.md", "shared.md"]);
        git(&other, &["commit", "-m", "remote rename"]);
        git(&other, &["push", "origin", "gitoza"]);

        git(&work, &["mv", "notes.md", "yours.md"]);

        let workflow = MemoryWorkflowStore::default();
        let push_failed = MemoryPushFailedStore::default();
        let engine = engine(&work, &workflow, &push_failed);

        let (_, contents) =
            expect_conflict(engine.publish("sync: rename").await.expect("publish"));
        let kinds: Vec<_> = contents
            .iter()
            .map(|c| {
                (
                    c.file_path.clone(),
                    c.conflict_kind.clone(),
                    c.your_path.clone(),
                    c.shared_path.clone(),
                    c.shared_deleted,
                )
            })
            .collect();

        let file = contents
            .iter()
            .find(|c| c.conflict_kind == "rename")
            .unwrap_or_else(|| panic!("expected rename conflict, got {kinds:?}"));
        assert!(
            file.your_path.as_deref() == Some("yours.md")
                || file.file_path == "yours.md"
                || file.related_paths.iter().any(|p| p == "yours.md"),
            "your path missing: {kinds:?}"
        );
        assert!(
            file.shared_path.as_deref() == Some("shared.md")
                || file.related_paths.iter().any(|p| p == "shared.md"),
            "shared path missing: {kinds:?}"
        );

        let chosen = file
            .your_path
            .clone()
            .unwrap_or_else(|| "yours.md".to_string());
        let content = file
            .your_content
            .clone()
            .unwrap_or_else(|| "same body\n".to_string());
        let mut related = file.related_paths.clone();
        if !related.iter().any(|p| p == "notes.md") {
            related.push("notes.md".into());
        }
        if !related.iter().any(|p| p == "shared.md") {
            related.push("shared.md".into());
        }

        let resolutions = vec![ConflictResolution {
            file_path: file.file_path.clone(),
            content: Some(content),
            conflict_kind: "rename".into(),
            action: None,
            shared_deleted: file.shared_deleted,
            new_path: None,
            chosen_path: Some(chosen),
            related_paths: related,
        }];
        expect_published(
            engine
                .resolve_and_finish(&resolutions)
                .await
                .expect("resolve"),
        );
        assert!(workflow.get_step().unwrap().is_none());
        assert_eq!(git(&work, &["show", "origin/gitoza:yours.md"]), "same body");
        let ls = git(&work, &["ls-tree", "-r", "--name-only", "origin/gitoza"]);
        assert!(
            ls.lines().any(|l| l == "yours.md"),
            "origin should have yours.md, ls={ls}"
        );
        assert!(
            !ls.lines().any(|l| l == "shared.md"),
            "origin should not keep shared.md, ls={ls}"
        );
        assert!(
            !ls.lines().any(|l| l == "notes.md"),
            "origin should not keep notes.md, ls={ls}"
        );
    }
}
