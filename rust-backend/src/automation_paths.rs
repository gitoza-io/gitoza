//! Path helpers for CI test-result artifacts under `{repo_slug}/test_results/`.

use crate::project_sync_config::ProjectSyncConfig;

pub const TEST_RESULTS_SUBFOLDER: &str = "test_results";

/// Relative path under repo storage root: `test_results/{pipeline}/{date}/{build_id}/`.
pub fn execution_folder_relative(pipeline: &str, date_folder: &str, build_id: &str) -> String {
    format!(
        "{TEST_RESULTS_SUBFOLDER}/{}/{}/{}/",
        sanitize_path_segment(pipeline),
        sanitize_path_segment(date_folder),
        sanitize_path_segment(build_id)
    )
}

/// Stable execution id used as SQLite primary key.
pub fn execution_id(pipeline: &str, date_folder: &str, build_id: &str) -> String {
    format!(
        "{}/{}/{}",
        sanitize_path_segment(pipeline),
        sanitize_path_segment(date_folder),
        sanitize_path_segment(build_id)
    )
}

/// Relative object path under `{repo_slug}/`: `test_results/.../junit.xml`.
pub fn execution_file_relative(
    pipeline: &str,
    date_folder: &str,
    build_id: &str,
    file_name: &str,
) -> String {
    format!(
        "{}{}",
        execution_folder_relative(pipeline, date_folder, build_id),
        sanitize_path_segment(file_name)
    )
}

/// Prefix for listing executions: `{repo_slug}/test_results/` (no leading global prefix).
pub fn test_results_repo_relative_prefix() -> &'static str {
    TEST_RESULTS_SUBFOLDER
}

/// Full S3 object key: `{optional_prefix}/{repo_slug}/{path_under_slug}`.
pub fn s3_repo_relative_key(
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    path_under_slug: &str,
) -> String {
    let slug = repo_slug.trim();
    let rel = path_under_slug.trim().trim_start_matches('/');
    let combined = if rel.is_empty() {
        slug.to_string()
    } else {
        format!("{slug}/{rel}")
    };
    let prefix = cfg
        .s3_prefix
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    if prefix.is_empty() {
        combined
    } else {
        let p = prefix.trim_end_matches('/');
        format!("{p}/{combined}")
    }
}

/// S3 list prefix ending with `/` for all objects under repo test results.
pub fn s3_test_results_list_prefix(cfg: &ProjectSyncConfig, repo_slug: &str) -> String {
    let rel = format!("{TEST_RESULTS_SUBFOLDER}/");
    let key = s3_repo_relative_key(cfg, repo_slug, &rel);
    if key.ends_with('/') {
        key
    } else {
        format!("{key}/")
    }
}

/// Stable case key within an execution (unique across junit files).
pub fn automation_case_key(junit_file: &str, classname: &str, name: &str) -> String {
    format!(
        "{}\x1f{}\x1f{}",
        junit_file.trim(),
        classname.trim(),
        name.trim()
    )
}

/// Stable suite key within an execution (`junit_file` + JUnit testsuite name).
pub fn automation_suite_key(junit_file: &str, suite_name: &str) -> String {
    format!("{}\x1f{}", junit_file.trim(), suite_name.trim())
}

/// Parse `automation_suite_key` into `(junit_file, suite_name)`.
pub fn parse_automation_suite_key(suite_key: &str) -> Option<(String, String)> {
    let mut parts = suite_key.splitn(2, '\x1f');
    let junit_file = parts.next()?.trim();
    let suite_name = parts.next()?.trim();
    if junit_file.is_empty() {
        return None;
    }
    Some((junit_file.to_string(), suite_name.to_string()))
}

/// Relative path under `{repo_slug}/` in the local JUnit cache: `{execution_id}/{junit_file}`.
pub fn cache_relative_path_for_junit(execution_id: &str, junit_file: &str) -> String {
    let exec = execution_id.trim().trim_matches('/');
    let file = sanitize_path_segment(junit_file.trim());
    format!("{exec}/{file}")
}

/// Reject path segments that could escape storage layout.
pub fn sanitize_path_segment(segment: &str) -> String {
    segment
        .trim()
        .replace('\\', "/")
        .split('/')
        .filter(|p| !p.is_empty() && *p != "." && *p != "..")
        .collect::<Vec<_>>()
        .join("_")
}

/// Parse `test_results/{pipeline}/{date}/{build_id}/{file}` from a relative path.
pub fn parse_execution_file_relative(relative: &str) -> Option<ExecutionPathParts> {
    let rel = relative.trim().trim_start_matches('/');
    let parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 5 || parts[0] != TEST_RESULTS_SUBFOLDER {
        return None;
    }
    let file_name = parts[4..].join("/");
    if file_name.is_empty() {
        return None;
    }
    Some(ExecutionPathParts {
        pipeline_name: parts[1].to_string(),
        date_folder: parts[2].to_string(),
        build_id: parts[3].to_string(),
        file_name,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPathParts {
    pub pipeline_name: String,
    pub date_folder: String,
    pub build_id: String,
    pub file_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_id_and_folder_relative() {
        assert_eq!(
            execution_id("nightly-api", "2024-06-01", "42"),
            "nightly-api/2024-06-01/42"
        );
        assert_eq!(
            execution_folder_relative("nightly-api", "2024-06-01", "42"),
            "test_results/nightly-api/2024-06-01/42/"
        );
    }

    #[test]
    fn s3_repo_relative_key_with_prefix() {
        let cfg = ProjectSyncConfig {
            provider_type: "cloud_api".to_string(),
            s3_prefix: Some("team-assets/".to_string()),
            ..Default::default()
        };
        assert_eq!(
            s3_repo_relative_key(
                &cfg,
                "my-repo",
                "test_results/nightly/2024-01-01/1/junit.xml"
            ),
            "team-assets/my-repo/test_results/nightly/2024-01-01/1/junit.xml"
        );
    }

    #[test]
    fn parse_execution_file_relative_valid() {
        let parsed = parse_execution_file_relative(
            "test_results/nightly/2024-01-01/build-1/junit-integration.xml",
        )
        .unwrap();
        assert_eq!(parsed.pipeline_name, "nightly");
        assert_eq!(parsed.build_id, "build-1");
        assert_eq!(parsed.file_name, "junit-integration.xml");
    }

    #[test]
    fn sanitize_rejects_traversal() {
        assert_eq!(sanitize_path_segment("../bad"), "bad");
    }

    #[test]
    fn cache_relative_path_for_junit_matches_execution_layout() {
        assert_eq!(
            cache_relative_path_for_junit("nightly-api/2026-06-24/42", "junit.xml"),
            "nightly-api/2026-06-24/42/junit.xml"
        );
    }
}
