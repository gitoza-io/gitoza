//! Git-only resolution for modify/delete conflicts during rebase (no blob reads).

use std::path::Path;

use anyhow::{anyhow, Result};
use sync_git::run::{git_run, git_stdout};

use crate::conflict;

/// Normalize legacy action names to tri-state intents.
pub fn normalize_modify_delete_intent(action: &str) -> Result<String> {
    match action {
        "keep_mine" | "keep_both" | "keep_theirs" => Ok(action.to_string()),
        // Legacy one-release compat
        "keep" => Ok("keep_mine".to_string()),
        "remove" => Ok("keep_theirs".to_string()),
        other => Err(anyhow!("unknown modify_delete intent: {other}")),
    }
}

/// Validate intent against shared_deleted before touching git.
pub fn validate_modify_delete_intent(intent: &str, shared_deleted: bool) -> Result<()> {
    if intent == "keep_both" && !shared_deleted {
        return Err(anyhow!(
            "keep_both is only valid when shared_deleted is true (remote deleted, you edited)"
        ));
    }
    Ok(())
}

pub async fn is_path_unmerged(repo_path: &Path, path: &str) -> Result<bool> {
    let out = git_stdout(repo_path, &["ls-files", "-u"]).await?;
    let stages = conflict::parse_ls_files_unmerged(&out);
    Ok(stages.contains_key(path))
}

async fn git_add_path(repo_path: &Path, path: &str) -> Result<()> {
    let r = git_run(repo_path, &["add", "--", path]).await?;
    if !r.success {
        return Err(anyhow!("git add {path} failed: {}", r.output));
    }
    Ok(())
}

async fn git_rm_path(repo_path: &Path, path: &str) -> Result<()> {
    let r = git_run(repo_path, &["rm", "-f", "--", path]).await?;
    if !r.success {
        return Err(anyhow!("git rm {path} failed: {}", r.output));
    }
    Ok(())
}

async fn maybe_add_unmerged_new_path(
    repo_path: &Path,
    old_path: &str,
    new_path: Option<&str>,
) -> Result<()> {
    if let Some(np) = new_path.filter(|p| *p != old_path) {
        if is_path_unmerged(repo_path, np).await? {
            git_add_path(repo_path, np).await?;
        }
    }
    Ok(())
}

/// Resolve a modify/delete conflict using only `git add` / `git rm` on working-tree content.
pub async fn resolve_modify_delete_intent(
    repo_path: &Path,
    old_path: &str,
    new_path: Option<&str>,
    shared_deleted: bool,
    intent: &str,
) -> Result<()> {
    let intent = normalize_modify_delete_intent(intent)?;
    validate_modify_delete_intent(intent.as_str(), shared_deleted)?;

    match intent.as_str() {
        "keep_mine" => {
            if shared_deleted {
                git_add_path(repo_path, old_path).await?;
            } else {
                git_rm_path(repo_path, old_path).await?;
            }
            maybe_add_unmerged_new_path(repo_path, old_path, new_path).await?;
        }
        "keep_both" => {
            git_add_path(repo_path, old_path).await?;
            maybe_add_unmerged_new_path(repo_path, old_path, new_path).await?;
        }
        "keep_theirs" => {
            if shared_deleted {
                git_rm_path(repo_path, old_path).await?;
                maybe_add_unmerged_new_path(repo_path, old_path, new_path).await?;
            } else {
                git_add_path(repo_path, old_path).await?;
            }
        }
        _ => return Err(anyhow!("unreachable intent: {intent}")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_legacy_actions() {
        assert_eq!(normalize_modify_delete_intent("keep").unwrap(), "keep_mine");
        assert_eq!(
            normalize_modify_delete_intent("remove").unwrap(),
            "keep_theirs"
        );
        assert_eq!(
            normalize_modify_delete_intent("keep_mine").unwrap(),
            "keep_mine"
        );
        assert!(normalize_modify_delete_intent("bogus").is_err());
    }

    #[test]
    fn keep_both_rejected_when_user_deleted() {
        assert!(validate_modify_delete_intent("keep_both", false).is_err());
        assert!(validate_modify_delete_intent("keep_both", true).is_ok());
    }
}
