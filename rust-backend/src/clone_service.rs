use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use crate::{git_process, repo_config, ssh_key};

fn url_with_token(url: &str, token: Option<&str>) -> String {
    let Some(token) = token.map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return url.trim().to_string();
    };
    let url = url.trim();
    if !url.to_lowercase().starts_with("http") {
        return url.to_string();
    }
    if url.contains('@') {
        return url.to_string();
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    format!("https://{token}@{rest}")
}

fn finish_clone_command(
    out: Result<Result<std::process::Output, std::io::Error>, tokio::time::error::Elapsed>,
) -> Result<std::process::Output> {
    match out {
        Err(_) => Err(anyhow!(
            "Clone timed out. Check the repository URL and network."
        )),
        Ok(Err(e)) => Err(anyhow!("Could not run git clone: {e}")),
        Ok(Ok(out)) => Ok(out),
    }
}

async fn remote_has_branch(url: &str, branch: &str, env: &[(&str, &str)]) -> bool {
    let refspec = format!("refs/heads/{branch}");
    let mut cmd = git_process::git_command(None);
    cmd.args(["ls-remote", "--heads", url, &refspec]);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(90), cmd.output()).await;
    let Ok(Ok(out)) = out else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some(refspec.as_str()))
}

async fn finalize_clone_work_branch(
    target: &Path,
    branch: &str,
    env: &[(&str, &str)],
) -> Result<Vec<String>> {
    let mut warnings: Vec<String> = Vec::new();

    let mut cmd = git_process::git_command(Some(target));
    cmd.args(["rev-parse", "--abbrev-ref", "HEAD"]);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await??;
    let current = if out.status.success() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        "".to_string()
    };

    async fn git_run(
        target: &Path,
        args: &[&str],
        env: &[(&str, &str)],
        timeout_s: u64,
    ) -> Result<(bool, String)> {
        let mut cmd = git_process::git_command(Some(target));
        cmd.args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }
        let out =
            tokio::time::timeout(std::time::Duration::from_secs(timeout_s), cmd.output()).await??;
        let mut s = String::new();
        s.push_str(&String::from_utf8_lossy(&out.stdout));
        s.push_str(&String::from_utf8_lossy(&out.stderr));
        Ok((out.status.success(), s.trim().to_string()))
    }

    if current == branch {
        let (ok, msg) = git_run(target, &["push", "-u", "origin", branch], env, 300).await?;
        if !ok {
            warnings.push(format!(
                "Branch {branch:?} is checked out but could not be pushed to origin (check permissions or network). Push manually when ready."
            ));
            let _ = msg;
        }
        return Ok(warnings);
    }

    let (ok, msg) = git_run(target, &["checkout", "-b", branch], env, 30).await?;
    if !ok {
        return Err(anyhow!("Could not create local branch {branch:?}: {}", msg));
    }
    let (ok, msg) = git_run(target, &["push", "-u", "origin", branch], env, 300).await?;
    if !ok {
        warnings.push(format!(
            "Created local branch {branch:?} but push to origin failed (check permissions or network). Push manually to share the branch."
        ));
        let _ = msg;
    }
    Ok(warnings)
}

pub async fn clone_remote_https(
    config_dir: &Path,
    remote_url: &str,
    token: Option<&str>,
    branch: &str,
) -> Result<(PathBuf, Vec<String>)> {
    let remote_url = remote_url.trim();
    if remote_url.is_empty() {
        return Err(anyhow!("Remote URL is required."));
    }
    let slug = repo_config::slug_from_url(remote_url);
    let target = config_dir.join(repo_config::REPOS_DIR).join(&slug);
    repo_config::ensure_app_data_dirs(config_dir).map_err(|e| {
        anyhow!(
            "Could not create app data directory {}: {e}",
            config_dir.display()
        )
    })?;
    if target.exists() {
        if target.join(".git").is_dir() {
            return Err(anyhow!(
                "A clone already exists at {}. Remove it first or use a different repository.",
                target.display()
            ));
        }
        return Err(anyhow!(
            "Path already exists and is not a Git repo: {}",
            target.display()
        ));
    }

    let url_with_auth = url_with_token(remote_url, token);
    let env: Vec<(&str, &str)> = Vec::new();

    let has_work = remote_has_branch(&url_with_auth, branch, &env).await;
    let mut cmd = git_process::git_command(Some(config_dir));
    if has_work {
        cmd.args([
            "clone",
            "--branch",
            branch,
            &url_with_auth,
            &target.to_string_lossy(),
        ]);
    } else {
        cmd.args(["clone", &url_with_auth, &target.to_string_lossy()]);
    }
    let out = finish_clone_command(
        tokio::time::timeout(std::time::Duration::from_secs(300), cmd.output()).await,
    )?;

    if !out.status.success() {
        let mut err = String::new();
        err.push_str(&String::from_utf8_lossy(&out.stderr));
        err.push_str(&String::from_utf8_lossy(&out.stdout));
        let err = err.trim().to_string();
        let lower = err.to_lowercase();
        if lower.contains("authentication failed") || lower.contains("invalid username or token") {
            return Err(anyhow!(
                "Invalid username or token. Check your Personal Access Token."
            ));
        }
        if lower.contains("could not read username") || lower.contains("permission denied") {
            return Err(anyhow!(
                "Authentication failed. Check your Personal Access Token."
            ));
        }
        if lower.contains("not found") || lower.contains("404") {
            return Err(anyhow!(
                "Repository not found. Check the URL and access rights."
            ));
        }
        if lower.contains("could not resolve host") {
            return Err(anyhow!(
                "Could not reach the remote host. Check the URL and network."
            ));
        }
        return Err(anyhow!(
            "Clone failed: {}",
            if err.is_empty() {
                "Unknown error"
            } else {
                &err
            }
        ));
    }

    let mut warnings = Vec::new();
    if !has_work {
        warnings = finalize_clone_work_branch(&target, branch, &env).await?;
    }

    Ok((target, warnings))
}

pub async fn clone_remote_ssh(
    config_dir: &Path,
    ssh_url: &str,
    branch: &str,
) -> Result<(PathBuf, Vec<String>)> {
    let ssh_url = ssh_url.trim();
    if !ssh_url.starts_with("git@") {
        return Err(anyhow!(
            "SSH URL must start with git@ (e.g. git@github.com:owner/repo.git)."
        ));
    }
    if !ssh_key::has_system_ssh_key() {
        return Err(anyhow!(
            "No SSH key found in ~/.ssh/. Create one (e.g. ssh-keygen -t ed25519) and add its public key to your Git server."
        ));
    }

    let slug = repo_config::slug_from_url(ssh_url);
    let target = config_dir.join(repo_config::REPOS_DIR).join(&slug);
    repo_config::ensure_app_data_dirs(config_dir).map_err(|e| {
        anyhow!(
            "Could not create app data directory {}: {e}",
            config_dir.display()
        )
    })?;
    if target.exists() {
        if target.join(".git").is_dir() {
            return Err(anyhow!(
                "A clone already exists at {}. Remove it first or use a different repository.",
                target.display()
            ));
        }
        return Err(anyhow!(
            "Path already exists and is not a Git repo: {}",
            target.display()
        ));
    }

    let env_ref: &[(&str, &str)] = &[];

    let has_work = remote_has_branch(ssh_url, branch, env_ref).await;
    let mut cmd = git_process::git_command(Some(config_dir));
    if has_work {
        cmd.args([
            "clone",
            "--branch",
            branch,
            ssh_url,
            &target.to_string_lossy(),
        ]);
    } else {
        cmd.args(["clone", ssh_url, &target.to_string_lossy()]);
    }
    let out = finish_clone_command(
        tokio::time::timeout(std::time::Duration::from_secs(300), cmd.output()).await,
    )?;
    if !out.status.success() {
        let mut err = String::new();
        err.push_str(&String::from_utf8_lossy(&out.stderr));
        err.push_str(&String::from_utf8_lossy(&out.stdout));
        let err = err.trim().to_string();
        let lower = err.to_lowercase();
        if lower.contains("permission denied") {
            return Err(anyhow!(
                "Authentication failed. Check your SSH key and access rights."
            ));
        }
        return Err(anyhow!(
            "Clone failed: {}",
            if err.is_empty() {
                "Unknown error"
            } else {
                &err
            }
        ));
    }

    let mut warnings = Vec::new();
    if !has_work {
        warnings = finalize_clone_work_branch(&target, branch, &env_ref).await?;
    }

    Ok((target, warnings))
}
