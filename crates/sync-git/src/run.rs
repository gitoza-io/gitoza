//! Async and blocking wrappers around `git` subprocess execution.

use std::path::Path;

use anyhow::{anyhow, Context, Result};

use crate::process::{git_command, git_command_blocking, network_git_env};

#[derive(Debug, Clone)]
pub struct GitRunResult {
    pub success: bool,
    pub output: String,
}

pub async fn git_stdout(repo_path: &Path, args: &[&str]) -> Result<String> {
    let r = git_run(repo_path, args).await?;
    if !r.success {
        return Err(anyhow!("git {:?} failed: {}", args, r.output));
    }
    Ok(r.output)
}

pub async fn git_run(repo_path: &Path, args: &[&str]) -> Result<GitRunResult> {
    git_run_env(repo_path, args, &[]).await
}

/// Run git with [`network_git_env`] (silent SSH / non-interactive GCM).
/// Unbounded — use for confirm push. Prefer [`git_run_network_timeout`] for fetch/pull.
pub async fn git_run_network(repo_path: &Path, args: &[&str]) -> Result<GitRunResult> {
    let env = network_git_env();
    let env_refs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    git_run_env(repo_path, args, &env_refs).await
}

/// Network git with a hard timeout. `kill_on_drop` terminates git (and SSH) when the
/// timeout future is dropped so a hung fetch cannot hold a repo lock forever.
pub async fn git_run_network_timeout(
    repo_path: &Path,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<GitRunResult> {
    let env = network_git_env();
    let env_refs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    git_run_env_timeout(repo_path, args, &env_refs, timeout).await
}

pub async fn git_run_env(
    repo_path: &Path,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<GitRunResult> {
    let mut cmd = git_command(Some(repo_path));
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().await?;
    Ok(git_output_to_result(out))
}

pub async fn git_run_env_timeout(
    repo_path: &Path,
    args: &[&str],
    env: &[(&str, &str)],
    timeout: std::time::Duration,
) -> Result<GitRunResult> {
    let mut cmd = git_command(Some(repo_path));
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.kill_on_drop(true);
    let secs = timeout.as_secs();
    match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(out)) => Ok(git_output_to_result(out)),
        Ok(Err(e)) => Err(e.into()),
        Err(_) => Err(anyhow!("git {:?} timed out after {}s", args, secs)),
    }
}

pub fn git_output_to_result(out: std::process::Output) -> GitRunResult {
    let mut s = String::new();
    s.push_str(&String::from_utf8_lossy(&out.stdout));
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    GitRunResult {
        success: out.status.success(),
        output: s.trim().to_string(),
    }
}

/// Blocking git stdout for sync index paths (no Tokio runtime required).
pub fn git_stdout_blocking(repo_path: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = git_command_blocking(Some(repo_path));
    cmd.args(args);
    let out = cmd
        .output()
        .with_context(|| format!("failed to run git {:?}", args))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("git {:?} failed: {}", args, err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn init_test_git_repo(dir: &Path, name: &str, email: &str) {
        Command::new("git")
            .current_dir(dir)
            .args(["init"])
            .output()
            .expect("git init");
        Command::new("git")
            .current_dir(dir)
            .args(["config", "user.name", name])
            .output()
            .expect("git config user.name");
        Command::new("git")
            .current_dir(dir)
            .args(["config", "user.email", email])
            .output()
            .expect("git config user.email");
    }

    #[tokio::test]
    async fn git_run_env_timeout_smoke_rev_parse() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Tester", "tester@example.com");
        let r = git_run_env_timeout(
            &repo_path,
            &["rev-parse", "--git-dir"],
            &[],
            std::time::Duration::from_secs(30),
        )
        .await
        .expect("timed rev-parse");
        assert!(r.success, "output={}", r.output);
    }

    #[tokio::test]
    async fn git_run_env_timeout_returns_err_on_hang() {
        // Same kill_on_drop + timeout pattern as network fetch; use `sleep` so the
        // test does not depend on a remote.
        let mut cmd = tokio::process::Command::new("sleep");
        cmd.arg("30");
        cmd.kill_on_drop(true);
        let err = tokio::time::timeout(std::time::Duration::from_secs(1), cmd.output()).await;
        assert!(err.is_err(), "sleep should exceed 1s timeout");
    }
}
