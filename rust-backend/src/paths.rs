use std::path::PathBuf;

/// Machine-local app data directory name under the user home directory.
pub const GITOZA_CONFIG_DIR_NAME: &str = ".gitoza";

/// Git work branch for test (and future) artifacts; must match frontend `GITOZA_WORK_BRANCH`.
pub const GITOZA_WORK_BRANCH: &str = "gitoza";

/// Fixed slug for the local playground workspace under `{config_dir}/repos/playground`.
pub const PLAYGROUND_SLUG: &str = "playground";

/// Relative path to the workspace kind marker inside a repo root.
pub const WORKSPACE_MARKER_REL: &str = ".gitoza/workspace.json";

/// Extension for workspace documents (cases, tickets, wiki, releases, run shards).
/// Content is Markdown with YAML frontmatter (run shards / project meta are frontmatter-only).
pub const WORKSPACE_DOC_EXT: &str = "md";

/// Filename suffix including the leading dot (`".md"`).
pub const WORKSPACE_DOC_SUFFIX: &str = ".md";

/// Ticket project metadata filename under `.gitoza/tasks/tickets/{project}/`.
pub const PROJECT_META_FILE: &str = ".project.md";

/// True when `ext` is the workspace document extension (no leading dot).
pub fn is_workspace_doc_ext(ext: &str) -> bool {
    ext.eq_ignore_ascii_case(WORKSPACE_DOC_EXT)
}

/// True when `name` ends with `.md` (case-insensitive).
pub fn has_workspace_doc_ext(name: &str) -> bool {
    name.to_ascii_lowercase()
        .ends_with(WORKSPACE_DOC_SUFFIX)
}

/// Join a stem with the workspace doc suffix, e.g. `DEMO-1` → `DEMO-1.md`.
pub fn workspace_doc_filename(stem: &str) -> String {
    format!("{stem}{WORKSPACE_DOC_SUFFIX}")
}

/// User home directory: `HOME`, then `USERPROFILE` on Windows, else `"."`.
pub fn user_home_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        if !profile.is_empty() {
            return PathBuf::from(profile);
        }
    }
    PathBuf::from(".")
}

/// Application data root (`~/.gitoza` on Unix, `%USERPROFILE%\.gitoza` on Windows).
pub fn default_config_dir() -> PathBuf {
    user_home_dir().join(GITOZA_CONFIG_DIR_NAME)
}

/// Absolute path to the fixed local playground clone: `{config_dir}/repos/playground`.
pub fn playground_repo_path(config_dir: &std::path::Path) -> PathBuf {
    config_dir
        .join(crate::repo_config::REPOS_DIR)
        .join(PLAYGROUND_SLUG)
}

/// Remote-tracking ref for the work branch, e.g. `origin/gitoza`.
pub fn origin_work_branch_ref() -> String {
    format!("origin/{GITOZA_WORK_BRANCH}")
}

/// Local head ref for the work branch, e.g. `refs/heads/gitoza`.
pub fn work_branch_head_ref() -> String {
    format!("refs/heads/{GITOZA_WORK_BRANCH}")
}
