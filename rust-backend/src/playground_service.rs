//! Create and bootstrap the fixed local playground workspace.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use crate::paths::{playground_repo_path, WORKSPACE_MARKER_REL};
use crate::repo_config;
use crate::workspace::WORKSPACE_KIND_PLAYGROUND;

const PLAYGROUND_GIT_NAME: &str = "Gitoza Playground";
const PLAYGROUND_GIT_EMAIL: &str = "playground@local";

const SAMPLE_CASE_1: &str = r#"---
title: Welcome to Gitoza
case_id: demo-welcome-001
status: active
priority: medium
approve_status: approved
tags: []
---

# Welcome to Gitoza

## Steps
1. Explore the demo project in the case tree
2. Edit this case or create a new one
3. Click **Save** when you have local changes

## Expected Result
You can try test management without connecting a remote repository.
"#;

const SAMPLE_CASE_2: &str = r#"---
title: Sample login check
case_id: demo-login-002
status: active
priority: high
approve_status: approved
tags: []
requirement_id: DEMO-1
---

# Sample login check

## Steps
1. Open the application
2. Enter valid credentials
3. Submit the login form

## Expected Result
User lands on the home screen.
"#;

const SAMPLE_TICKET_1: &str = r#"---
title: Welcome ticket
type: task
status: open
priority: medium
tags:
  - demo
sprint: playground
---

# Welcome ticket

## Description
Explore Tasks in Gitoza. Tickets live as YAML under `.gitoza/tasks/tickets/{project}/`.

## Acceptance criteria
- Open this ticket in the Tasks view
- Create a new ticket or edit this one
"#;

const SAMPLE_TICKET_2: &str = r#"---
title: Fix sample login redirect
type: bug
status: open
priority: high
tags:
  - auth
  - demo
sprint: playground
---

# Fix sample login redirect

## Description
Example bug linked from the sample login test case via `requirement_id: DEMO-1`.

## Acceptance criteria
- Linked cases appear on this ticket detail
"#;

/// Create or reuse `{config_dir}/repos/playground` with git init and sample content.
pub async fn create_or_open_playground(config_dir: &Path) -> Result<PathBuf> {
    repo_config::ensure_app_data_dirs(config_dir)?;
    let target = playground_repo_path(config_dir);

    if !target.is_dir() {
        scaffold_playground_tree(&target)?;
    } else {
        ensure_playground_marker(&target)?;
    }

    ensure_git_repo_initialized(&target).await?;
    Ok(target)
}

fn scaffold_playground_tree(target: &Path) -> Result<()> {
    fs::create_dir_all(target.join(".gitoza/test/cases/demo.gitoza.test"))?;
    fs::create_dir_all(target.join(".gitoza/test/runs"))?;
    fs::create_dir_all(target.join(".gitoza/test/templates"))?;
    fs::create_dir_all(target.join(".gitoza/tasks/tickets/demo"))?;

    fs::write(
        target.join(WORKSPACE_MARKER_REL),
        serde_json::json!({ "kind": WORKSPACE_KIND_PLAYGROUND }).to_string(),
    )?;
    fs::write(
        target.join(".gitoza/config.json"),
        serde_json::json!({ "enable_review_system": false }).to_string(),
    )?;

    let cases_dir = target.join(".gitoza/test/cases/demo.gitoza.test");
    fs::write(cases_dir.join("demo-welcome-001.md"), SAMPLE_CASE_1)?;
    fs::write(cases_dir.join("demo-login-002.md"), SAMPLE_CASE_2)?;

    let tickets_dir = target.join(".gitoza/tasks/tickets/demo");
    fs::write(
        tickets_dir.join(".project.md"),
        "---\nticket_prefix: DEMO\n---\n\n",
    )?;
    fs::write(tickets_dir.join("DEMO-1.md"), SAMPLE_TICKET_2)?;
    fs::write(tickets_dir.join("DEMO-welcome.md"), SAMPLE_TICKET_1)?;

    // Keep empty dirs visible in git.
    fs::write(target.join(".gitoza/test/runs/.gitkeep"), "")?;
    fs::write(target.join(".gitoza/test/templates/.gitkeep"), "")?;

    Ok(())
}

fn ensure_playground_marker(target: &Path) -> Result<()> {
    let marker = target.join(WORKSPACE_MARKER_REL);
    if marker.is_file() {
        return Ok(());
    }
    if target.join(".git").is_dir() {
        return Err(anyhow!(
            "Path {} exists but is not a playground workspace.",
            target.display()
        ));
    }
    scaffold_playground_tree(target)
}

async fn ensure_git_repo_initialized(target: &Path) -> Result<()> {
    let git_dir = target.join(".git");
    if !git_dir.is_dir() {
        let init = crate::git_run(target, &["init"]).await?;
        if !init.success {
            return Err(anyhow!("git init failed: {}", init.output));
        }
    }

    crate::git_set_local_user(target, PLAYGROUND_GIT_NAME, PLAYGROUND_GIT_EMAIL).await?;

    if has_commits(target).await? {
        return Ok(());
    }

    let add = crate::git_run(target, &["add", "."]).await?;
    if !add.success {
        return Err(anyhow!("git add failed: {}", add.output));
    }

    let commit = crate::git_run(target, &["commit", "-m", "Initial playground"]).await?;
    if !commit.success {
        return Err(anyhow!("git commit failed: {}", commit.output));
    }

    Ok(())
}

async fn has_commits(repo_path: &Path) -> Result<bool> {
    let r = crate::git_run(repo_path, &["rev-parse", "HEAD"]).await?;
    Ok(r.success)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_dir() -> PathBuf {
        std::env::temp_dir().join(format!("gitoza_pg_{}", uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn create_or_open_playground_scaffolds_and_commits() {
        let config = temp_config_dir();
        let path = create_or_open_playground(&config).await.unwrap();
        assert_eq!(
            path.file_name().unwrap().to_str().unwrap(),
            crate::paths::PLAYGROUND_SLUG
        );
        assert!(path.join(".git").is_dir());
        assert!(path.join(WORKSPACE_MARKER_REL).is_file());
        assert!(path
            .join(".gitoza/test/cases/demo.gitoza.test/demo-welcome-001.md")
            .is_file());
        assert!(path
            .join(".gitoza/tasks/tickets/demo/DEMO-1.md")
            .is_file());
        assert!(path
            .join(".gitoza/tasks/tickets/demo/.project.md")
            .is_file());
        assert!(has_commits(&path).await.unwrap());

        let path2 = create_or_open_playground(&config).await.unwrap();
        assert_eq!(path, path2);

        let _ = fs::remove_dir_all(&config);
    }

    #[tokio::test]
    async fn confirm_changes_rejected_for_playground() {
        let config = temp_config_dir();
        let state = crate::new_state(config.clone());
        let path = create_or_open_playground(&config).await.unwrap();
        crate::repo_config::save_playground_config(&config, &path).unwrap();

        let err = crate::ipc_api::confirm_changes(&state, Some("playground".to_string())).await;
        assert!(err.is_err());
        assert_eq!(err.unwrap_err().code, "bad_request");

        let _ = fs::remove_dir_all(&config);
    }

    #[tokio::test]
    async fn playground_save_commits_dirty_case_changes() {
        let config = temp_config_dir();
        let state = crate::new_state(config.clone());
        let path = create_or_open_playground(&config).await.unwrap();
        crate::repo_config::save_playground_config(&config, &path).unwrap();
        let slug = crate::paths::PLAYGROUND_SLUG;

        let case_path = path.join(".gitoza/test/cases/demo.gitoza.test/demo-welcome-001.md");
        let mut content = fs::read_to_string(&case_path).unwrap();
        content.push_str("\n# edited for test\n");
        fs::write(&case_path, content).unwrap();

        let dirty = crate::read_repo_status(&state, slug, &path).await.unwrap();
        assert_eq!(dirty.workplace_mode, "editing");
        assert!(dirty.case_files_dirty);

        let save = crate::ipc_api::playground_save_changes(&state, Some(slug.to_string()))
            .await
            .unwrap();
        assert!(save.success);

        let clean = crate::read_repo_status(&state, slug, &path).await.unwrap();
        assert_eq!(clean.workplace_mode, "baseline");
        assert!(!clean.case_files_dirty);

        let _ = fs::remove_dir_all(&config);
    }
}
