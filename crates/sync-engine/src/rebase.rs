//! Rebase helpers: detect in-progress rebase, abort, continue, read conflicts.

use std::collections::HashSet;
use std::path::Path;

use anyhow::Result;
use sync_git::run::{git_run, git_run_env, git_stdout};

use crate::conflict;
use crate::types::ConflictFile;

pub async fn is_rebase_in_progress(repo_path: &Path) -> Result<bool> {
    let out = git_stdout(repo_path, &["rev-parse", "--git-dir"]).await?;
    let git_dir = repo_path.join(out.trim());
    Ok(git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply").is_dir())
}

pub async fn abort_rebase_impl(repo_path: &Path) -> Result<()> {
    let _ = git_run(repo_path, &["rebase", "--abort"]).await;
    // Put confirm commit back into working tree (best-effort).
    let _ = git_run(repo_path, &["reset", "--mixed", "HEAD~1"]).await;
    Ok(())
}

pub async fn git_show_index_stage(
    repo_path: &Path,
    stage: u8,
    path: &str,
) -> Option<String> {
    let spec = format!(":{}:{}", stage, path);
    git_stdout(repo_path, &["show", &spec]).await.ok()
}

pub fn is_safe_repo_relative_path(p: &str) -> bool {
    !p.is_empty() && !p.contains("..") && !p.starts_with('/')
}

pub async fn apply_rename_resolution(
    repo_path: &Path,
    chosen_path: &str,
    content: &str,
    paths_to_remove: &[String],
) -> Result<()> {
    let full = repo_path.join(chosen_path);
    if let Some(parent) = full.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&full, content).await?;
    git_run(repo_path, &["add", chosen_path]).await?;
    for rp in paths_to_remove {
        if rp == chosen_path || !is_safe_repo_relative_path(rp) {
            continue;
        }
        let _ = git_run(repo_path, &["rm", "-f", "--", rp]).await;
    }
    Ok(())
}

#[derive(Debug)]
pub enum RebaseContinueResult {
    Completed,
    MoreConflicts(Vec<String>, Vec<ConflictFile>),
    Failed(String),
}

pub async fn continue_rebase_until_done(repo_path: &Path) -> Result<RebaseContinueResult> {
    const MAX_ITERATIONS: usize = 20;
    for _ in 0..MAX_ITERATIONS {
        let cont = git_run_env(
            repo_path,
            &["rebase", "--continue"],
            &[("GIT_EDITOR", "true")],
        )
        .await?;
        if cont.success {
            return Ok(RebaseContinueResult::Completed);
        }
        let out_lower = cont.output.to_lowercase();
        if out_lower.contains("conflict") {
            let (files, contents) = read_conflicts(repo_path).await?;
            return Ok(RebaseContinueResult::MoreConflicts(files, contents));
        }
        if out_lower.contains("nothing to commit")
            || out_lower.contains("no changes")
            || out_lower.contains("now empty")
        {
            let skip = git_run(repo_path, &["rebase", "--skip"]).await?;
            if skip.success {
                continue;
            }
        }
        return Ok(RebaseContinueResult::Failed(cont.output));
    }
    Ok(RebaseContinueResult::Failed(
        "rebase continue exceeded max iterations".to_string(),
    ))
}

pub async fn read_conflicts(repo_path: &Path) -> Result<(Vec<String>, Vec<ConflictFile>)> {
    let mut paths: Vec<String> = vec![];
    let mut seen = HashSet::<String>::new();
    if let Ok(out) = git_stdout(repo_path, &["diff", "--name-only", "--diff-filter=U"]).await {
        for line in out.lines() {
            let p = line.trim();
            if !p.is_empty() && seen.insert(p.to_string()) {
                paths.push(p.to_string());
            }
        }
    }
    let ls_files_out = git_stdout(repo_path, &["ls-files", "-u"])
        .await
        .unwrap_or_default();
    let all_stages = conflict::parse_ls_files_unmerged(&ls_files_out);
    for line in ls_files_out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let p = parts[3];
            if !p.is_empty() && seen.insert(p.to_string()) {
                paths.push(p.to_string());
            }
        }
    }

    let primary_paths = conflict::primary_paths_for_conflicts(&paths, &all_stages);
    let mut contents = vec![];
    for p in &primary_paths {
        let full = repo_path.join(p);
        let working_tree = tokio::fs::read_to_string(&full).await.unwrap_or_default();

        let (stage_2_path, stage_3_path) = conflict::stage_paths_for_content(p, &all_stages);
        let stage_2_content = if let Some(ref s2) = stage_2_path {
            git_show_index_stage(repo_path, 2, s2).await
        } else {
            None
        };
        let stage_3_content = if let Some(ref s3) = stage_3_path {
            git_show_index_stage(repo_path, 3, s3).await
        } else {
            None
        };

        let classification = conflict::classify_conflict(
            p,
            &working_tree,
            &all_stages,
            stage_2_content.as_deref(),
            stage_3_content.as_deref(),
        );

        contents.push(ConflictFile {
            file_path: p.clone(),
            content: working_tree,
            conflict_kind: classification.kind.clone(),
            shared_deleted: classification.shared_deleted,
            your_content: classification.your_content.or(stage_3_content).filter(|_| {
                classification.kind == "modify_delete" || classification.has_content_conflict
            }),
            shared_content: classification
                .shared_content
                .or(stage_2_content)
                .filter(|_| {
                    classification.has_content_conflict || classification.kind == "modify_delete"
                }),
            your_path: classification.your_path,
            shared_path: classification.shared_path,
            base_path: classification.base_path,
            has_content_conflict: classification.has_content_conflict,
            related_paths: classification.related_paths,
        });
    }
    Ok((primary_paths, contents))
}
