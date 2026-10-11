//! Spawn `git` without visible consoles on Windows; limit concurrent `git show` during indexing.

use std::path::Path;
use std::sync::OnceLock;

use anyhow::{anyhow, Result};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::ssh_silent;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const GIT_SHOW_CONCURRENCY: usize = 4;

static GIT_SHOW_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();

/// Environment for non-interactive network Git (fetch / pull / push).
///
/// On Windows, prefers `GIT_SSH` pointing at the same-binary `gitoza-ssh-silent` shim so Git does
/// not invoke SSH via a shell (`sh.exe` flash). Falls back to `GIT_SSH_COMMAND` with BatchMode
/// and connect/keepalive so hung sockets die sooner than TCP defaults.
/// Always sets `GCM_INTERACTIVE=never` so Git Credential Manager stays non-interactive.
pub fn network_git_env() -> Vec<(String, String)> {
    let mut env = vec![("GCM_INTERACTIVE".to_string(), "never".to_string())];
    if let Some(shim) = ssh_silent::ensure_ssh_silent_shim() {
        env.push(("GIT_SSH".to_string(), shim.to_string_lossy().into_owned()));
    } else {
        let mut cmd = String::from("ssh");
        for opt in ssh_silent::NETWORK_SSH_OPTIONS {
            cmd.push_str(" -o ");
            cmd.push_str(opt);
        }
        env.push(("GIT_SSH_COMMAND".to_string(), cmd));
    }
    env
}

/// Build a `git` command with platform defaults (hidden console on Windows, no terminal prompts).
pub fn git_command(repo_path: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    if let Some(dir) = repo_path {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Blocking (`std::process`) counterpart of [`git_command`] for sync paths without a Tokio runtime.
pub fn git_command_blocking(repo_path: Option<&Path>) -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    if let Some(dir) = repo_path {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Limit parallel `git show` during run snapshot indexing.
pub fn git_show_semaphore() -> &'static Semaphore {
    GIT_SHOW_SEMAPHORE.get_or_init(|| Semaphore::new(GIT_SHOW_CONCURRENCY))
}

/// Run `git` without a repo working directory (e.g. `git config --global`).
pub async fn git_run_global(args: &[&str]) -> Result<GitGlobalRunResult> {
    let out = git_command(None).args(args).output().await?;
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(GitGlobalRunResult {
        success: out.status.success(),
        output: s.trim().to_string(),
    })
}

/// Successful stdout from global git, or error when the command failed.
#[allow(dead_code)]
pub async fn git_stdout_global(args: &[&str]) -> Result<String> {
    let r = git_run_global(args).await?;
    if !r.success {
        return Err(anyhow!("git {:?} failed: {}", args, r.output));
    }
    Ok(r.output)
}

#[derive(Debug, Clone)]
pub struct GitGlobalRunResult {
    pub success: bool,
    pub output: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_git_env_includes_ssh_connect_and_keepalive() {
        let env = network_git_env();
        let ssh_cmd = env
            .iter()
            .find(|(k, _)| k == "GIT_SSH_COMMAND")
            .map(|(_, v)| v.as_str());
        // Non-Windows uses GIT_SSH_COMMAND; Windows may use GIT_SSH shim instead.
        if let Some(cmd) = ssh_cmd {
            assert!(cmd.contains("BatchMode=yes"), "{cmd}");
            assert!(cmd.contains("ConnectTimeout=15"), "{cmd}");
            assert!(cmd.contains("ServerAliveInterval=10"), "{cmd}");
            assert!(cmd.contains("ServerAliveCountMax=3"), "{cmd}");
        } else {
            assert!(
                env.iter().any(|(k, _)| k == "GIT_SSH"),
                "expected GIT_SSH or GIT_SSH_COMMAND: {env:?}"
            );
        }
        assert!(
            env.iter().any(|(k, v)| k == "GCM_INTERACTIVE" && v == "never"),
            "expected GCM_INTERACTIVE=never: {env:?}"
        );
    }
}
