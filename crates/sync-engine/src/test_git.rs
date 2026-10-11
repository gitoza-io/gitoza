//! Shared real-Git fixtures for sync-engine integration tests.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use crate::publish::SyncEngine;
use crate::store::{MemoryPushFailedStore, MemoryWorkflowStore};

pub const WORK_BRANCH: &str = "gitoza";

pub fn git(cwd: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Worktree with a local bare `origin` remote on branch `gitoza`.
pub fn setup_with_origin(tmp: &Path) -> (PathBuf, PathBuf) {
    setup_with_files(tmp, &[("f.txt", "base\n")])
}

pub fn setup_with_files(tmp: &Path, files: &[(&str, &str)]) -> (PathBuf, PathBuf) {
    let bare = tmp.join("origin.git");
    let work = tmp.join("work");
    std::fs::create_dir_all(&work).unwrap();
    let init = Command::new("git")
        .args(["init", "--bare", bare.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        init.status.success(),
        "git init --bare failed: {}",
        String::from_utf8_lossy(&init.stderr)
    );

    git(&work, &["init"]);
    git(&work, &["config", "user.name", "Tester"]);
    git(&work, &["config", "user.email", "t@example.com"]);
    for (rel, contents) in files {
        let path = work.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, contents).unwrap();
    }
    git(&work, &["add", "."]);
    git(&work, &["commit", "-m", "init"]);
    git(&work, &["branch", "-M", WORK_BRANCH]);
    git(
        &work,
        &["remote", "add", "origin", bare.to_str().unwrap()],
    );
    git(&work, &["push", "-u", "origin", WORK_BRANCH]);
    (work, bare)
}

pub fn clone_other(bare: &Path, dest: &Path) {
    let out = Command::new("git")
        .args([
            "clone",
            "-b",
            WORK_BRANCH,
            bare.to_str().unwrap(),
            dest.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git clone failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    git(dest, &["config", "user.name", "Other"]);
    git(dest, &["config", "user.email", "o@example.com"]);
}

pub fn head_sha(cwd: &Path) -> String {
    git(cwd, &["rev-parse", "HEAD"])
}

pub fn engine<'a>(
    work: &'a Path,
    workflow: &'a MemoryWorkflowStore,
    push_failed: &'a MemoryPushFailedStore,
) -> SyncEngine<'a> {
    SyncEngine {
        repo_path: work,
        work_branch: WORK_BRANCH,
        lock: Arc::new(tokio::sync::Mutex::new(())),
        workflow,
        push_failed,
    }
}
