//! Workspace kind detection (remote Git vs local playground).

use std::path::Path;

use crate::error::ApiError;
use crate::paths::WORKSPACE_MARKER_REL;
use crate::AppState;

pub const WORKSPACE_KIND_REMOTE_GIT: &str = "remote_git";
pub const WORKSPACE_KIND_PLAYGROUND: &str = "playground";

const PLAYGROUND_GUARD_MSG: &str =
    "Playground is local-only. Connect a remote repository to sync with others.";

#[derive(Debug, serde::Deserialize)]
struct WorkspaceMarker {
    kind: String,
}

/// True when `{repo}/.gitoza/workspace.json` declares `kind: playground`.
pub fn is_playground_repo(repo_path: &Path) -> bool {
    workspace_kind_for_repo(repo_path) == WORKSPACE_KIND_PLAYGROUND
}

pub fn workspace_kind_for_repo(repo_path: &Path) -> &'static str {
    let marker_path = repo_path.join(WORKSPACE_MARKER_REL);
    let Ok(raw) = std::fs::read_to_string(&marker_path) else {
        return WORKSPACE_KIND_REMOTE_GIT;
    };
    let Ok(parsed) = serde_json::from_str::<WorkspaceMarker>(&raw) else {
        return WORKSPACE_KIND_REMOTE_GIT;
    };
    if parsed
        .kind
        .trim()
        .eq_ignore_ascii_case(WORKSPACE_KIND_PLAYGROUND)
    {
        WORKSPACE_KIND_PLAYGROUND
    } else {
        WORKSPACE_KIND_REMOTE_GIT
    }
}

pub fn is_playground_slug(state: &AppState, slug: &str) -> bool {
    crate::resolve_repo_path(state, Some(slug))
        .map(|p| is_playground_repo(&p))
        .unwrap_or(false)
}

/// Rejects playground workspaces for remote sync / confirm / push endpoints.
pub fn require_remote_git_workspace(state: &AppState, slug: &str) -> Result<(), ApiError> {
    if is_playground_slug(state, slug) {
        return Err(ApiError::bad_request(PLAYGROUND_GUARD_MSG));
    }
    Ok(())
}

/// Rejects non-playground workspaces for playground-only endpoints.
pub fn require_playground_workspace(state: &AppState, slug: &str) -> Result<(), ApiError> {
    if !is_playground_slug(state, slug) {
        return Err(ApiError::bad_request(
            "Local save is only available in the playground workspace.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn is_playground_repo_reads_marker() {
        let base = std::env::temp_dir().join(format!("gitoza_ws_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join(".gitoza")).unwrap();
        assert!(!is_playground_repo(&base));
        fs::write(base.join(WORKSPACE_MARKER_REL), r#"{"kind":"playground"}"#).unwrap();
        assert!(is_playground_repo(&base));
        assert_eq!(workspace_kind_for_repo(&base), WORKSPACE_KIND_PLAYGROUND);
        let _ = fs::remove_dir_all(&base);
    }
}
