use std::fs;
use std::path::Path;

use anyhow::Result;
use serde::{Deserialize, Serialize};

pub const CONFIG_FILE: &str = "config.json";
pub const REPOS_DIR: &str = "repos";

/// Ensures `{config_dir}` and `{config_dir}/repos` exist (required before `git clone`).
pub fn ensure_app_data_dirs(config_dir: &Path) -> Result<()> {
    fs::create_dir_all(config_dir.join(REPOS_DIR))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConfig {
    pub repo_path: String,
    pub remote_url: Option<String>,
    pub branch: String,
    pub token_stored: bool,
    pub connection_type: String,
}

fn sanitize_slug_part(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    out.trim_matches('.').trim_matches('_').to_string()
}

fn parse_owner_repo_from_url(url: &str) -> (Option<String>, Option<String>) {
    let mut u = url.trim().trim_end_matches('/');
    if u.ends_with(".git") {
        u = &u[..u.len() - 4];
    }

    // SSH: git@host:owner/repo
    if let Some(after) = u.strip_prefix("git@") {
        if let Some(idx) = after.find(':') {
            let part = &after[idx + 1..];
            let segs: Vec<&str> = part.split('/').filter(|x| !x.is_empty()).collect();
            if segs.len() >= 2 {
                return (
                    Some(segs[segs.len() - 2].to_string()),
                    Some(segs[segs.len() - 1].to_string()),
                );
            }
            return (None, segs.last().map(|s| s.to_string()));
        }
    }

    // HTTPS: .../owner/repo
    let segs: Vec<&str> = u.split('/').filter(|x| !x.is_empty()).collect();
    if segs.len() >= 2 {
        return (
            Some(segs[segs.len() - 2].to_string()),
            Some(segs[segs.len() - 1].to_string()),
        );
    }

    (None, segs.last().map(|s| s.to_string()))
}

pub fn slug_from_url(url: &str) -> String {
    let u = url.trim();
    if u.is_empty() {
        return "repo".to_string();
    }

    // Try SSH parsing first.
    if u.starts_with("git@") && u.contains(':') {
        let part = u.split(':').nth(1).unwrap_or("").trim();
        let segs: Vec<&str> = part.split('/').filter(|x| !x.is_empty()).collect();
        if segs.len() >= 2 {
            let owner = sanitize_slug_part(segs[segs.len() - 2]);
            let repo = sanitize_slug_part(segs[segs.len() - 1]);
            return format!("{}_{}", owner, repo);
        }
        return sanitize_slug_part(part);
    }

    // HTTPS parsing.
    let (owner, repo) = parse_owner_repo_from_url(u);
    if let (Some(o), Some(r)) = (owner.as_ref(), repo.as_ref()) {
        return format!("{}_{}", sanitize_slug_part(o), sanitize_slug_part(r));
    }
    sanitize_slug_part(repo.as_deref().unwrap_or(u))
}

fn write_config_file(config_dir: &Path, cfg: &StoredConfig) -> Result<()> {
    ensure_app_data_dirs(config_dir)?;
    let out = serde_json::to_string_pretty(cfg)?;
    let cfg_file = config_dir.join(CONFIG_FILE);
    fs::write(&cfg_file, out)?;

    // Best-effort chmod 0o600 (POSIX).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&cfg_file)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&cfg_file, perms)?;
    }
    Ok(())
}

pub fn save_config(
    config_dir: &Path,
    repo_path: &Path,
    remote_url: &str,
    branch: &str,
    token_stored: bool,
    connection_type: &str,
) -> Result<()> {
    let cfg = StoredConfig {
        repo_path: repo_path.to_string_lossy().to_string(),
        remote_url: Some(remote_url.to_string()),
        branch: branch.to_string(),
        token_stored,
        connection_type: connection_type.to_string(),
    };
    write_config_file(config_dir, &cfg)
}

/// Persist app config for the local playground workspace (no remote URL).
pub fn save_playground_config(config_dir: &Path, repo_path: &Path) -> Result<()> {
    let cfg = StoredConfig {
        repo_path: repo_path.to_string_lossy().to_string(),
        remote_url: None,
        branch: "main".to_string(),
        token_stored: false,
        connection_type: "playground".to_string(),
    };
    write_config_file(config_dir, &cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn ensure_app_data_dirs_creates_config_and_repos() {
        let base =
            std::env::temp_dir().join(format!("gitoza_ensure_dirs_{}", uuid::Uuid::new_v4()));
        ensure_app_data_dirs(&base).unwrap();
        assert!(base.is_dir());
        assert!(base.join(REPOS_DIR).is_dir());
        let _ = fs::remove_dir_all(&base);
    }
}
