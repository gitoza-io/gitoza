use std::path::{Path, PathBuf};

use regex::{Captures, Regex};

use crate::markdown_pdf::{split_markdown_for_pdf, BodySegment};
use crate::{asset_store, asset_sync, AppState};

/// A4 page width; must stay in sync with Typst `#set page` (default paper).
const PAGE_WIDTH_MM: f64 = 210.0;
/// Horizontal margin per side in [`test_case_export.typ`](../templates/test_case_export.typ).
const PAGE_MARGIN_X_MM: f64 = 18.0;
/// Printable content width in CSS px (96 dpi), used to scale `![alt|WIDTH](file)` for PDF.
pub const MAX_CONTENT_WIDTH_PX: f64 = (PAGE_WIDTH_MM - 2.0 * PAGE_MARGIN_X_MM) / 25.4 * 96.0;

/// Map editor image width (px) to a column-relative percentage for Typst `image(width: …%)`.
pub fn pdf_image_width_percent(width_px: Option<f64>) -> f64 {
    match width_px {
        None => 100.0,
        Some(px) => (px.min(MAX_CONTENT_WIDTH_PX) / MAX_CONTENT_WIDTH_PX) * 100.0,
    }
}

fn escape_typst_string_literal(value: &str) -> String {
    // Typst string literals use backslash escapes for `"` and `\`.
    value.replace('\\', r"\\").replace('\"', r#"\""#)
}

fn extract_obsidian_width_px(alt: &str) -> Option<f64> {
    // Accept `anything|400` with optional whitespace around the pipe.
    let (_, w) = alt.rsplit_once('|')?;
    let w = w.trim();
    if w.is_empty() {
        return None;
    }
    w.parse::<f64>().ok().filter(|n| n.is_finite() && *n > 0.0)
}

fn px_to_pt(px: f64) -> f64 {
    // CSS px at 96dpi -> points at 72dpi
    px * 72.0 / 96.0
}

fn format_pt(pt: f64) -> String {
    // Keep output stable and readable: 1 decimal max, but drop `.0`.
    let rounded = (pt * 10.0).round() / 10.0;
    if (rounded.fract()).abs() < 1e-9 {
        format!("{:.0}", rounded)
    } else {
        format!("{:.1}", rounded)
    }
}

fn basename_only(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
    let normalized = trimmed.replace('\\', "/");
    normalized
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn placeholder(file_name: &str) -> String {
    format!("_[Missing Image: {file_name}]_")
}

/// Typst path relative to project root (`~/.gitoza` via `with_file_system_resolver`).
fn typst_project_image_path(repo_slug: &str, file_name: &str) -> String {
    format!("/{}/{repo_slug}/{file_name}", asset_store::ASSETS_CACHE_DIR)
}

async fn resolve_image_for_pdf(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    file_name: &str,
) -> Option<PathBuf> {
    if resolve_cache_path(state, repo_slug, file_name).is_err() {
        return None;
    }
    if asset_store::cache_hit(state, repo_slug, file_name) {
        return Some(asset_store::cache_file_path(state, repo_slug, file_name));
    }
    let repo_path = repo_path?;
    asset_sync::ensure_in_cache(state, repo_slug, repo_path, file_name)
        .await
        .ok()
        .filter(|p| p.is_file())
}

async fn image_segment_from_token(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    alt: &str,
    target: &str,
) -> BodySegment {
    let file_name = basename_only(target);
    if file_name.is_empty() {
        return BodySegment::Markdown(placeholder("unknown"));
    }

    let Some(cache_path) = resolve_image_for_pdf(state, repo_slug, repo_path, &file_name).await
    else {
        return BodySegment::Markdown(placeholder(&file_name));
    };

    if !cache_path.is_file() {
        return BodySegment::Markdown(placeholder(&file_name));
    }

    let typst_path = typst_project_image_path(repo_slug, &file_name);
    let width_percent = pdf_image_width_percent(extract_obsidian_width_px(alt));
    BodySegment::Image {
        path: typst_path,
        width_percent,
    }
}

/// Split markdown for PDF export, extracting images as native Typst `image` segments (not cmarker).
///
/// When `repo_path` is set and an image is missing from the local cache, resolves it from
/// S3 or the configured local assets folder per `.gitoza/config.json`.
pub async fn split_body_for_pdf(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    markdown: &str,
) -> Vec<BodySegment> {
    let re = Regex::new(r"!\[(.*?)\]\((.*?)\)").expect("markdown image regex must compile");
    let mut out: Vec<BodySegment> = Vec::new();
    let mut last_end = 0usize;

    for caps in re.captures_iter(markdown) {
        let m = match caps.get(0) {
            Some(m) => m,
            None => continue,
        };
        if m.start() > last_end {
            out.extend(split_markdown_for_pdf(&markdown[last_end..m.start()]));
        }
        let alt = caps.get(1).map(|c| c.as_str()).unwrap_or("");
        let target = caps.get(2).map(|c| c.as_str()).unwrap_or("");
        out.push(image_segment_from_token(state, repo_slug, repo_path, alt, target).await);
        last_end = m.end();
    }

    if last_end < markdown.len() {
        out.extend(split_markdown_for_pdf(&markdown[last_end..]));
    }

    out
}

fn resolve_cache_path(
    state: &AppState,
    repo_slug: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if repo_slug.trim().is_empty() {
        return Err("Missing repo slug".to_string());
    }
    if !crate::is_safe_repo_slug(repo_slug) {
        return Err("Invalid repo slug".to_string());
    }
    asset_store::validate_file_name(file_name)?;
    Ok(asset_store::cache_file_path(state, repo_slug, file_name))
}

/// Preprocess Markdown image tokens (`![](file)` / `![alt|400](file)`) into Typst-native `#image(...)`
/// using the local per-repo cache under `~/.gitoza/assets_cache/{repo_slug}/`.
///
/// - Existing assets become `#image("/assets_cache/{slug}/{file}", ...)` (Typst project-root path).
/// - Missing / invalid assets become `_[Missing Image: filename]_` (non-fatal).
pub fn preprocess_markdown_images(state: &AppState, repo_slug: &str, markdown: &str) -> String {
    let re = Regex::new(r"!\[(.*?)\]\((.*?)\)").expect("markdown image regex must compile");

    re.replace_all(markdown, |caps: &Captures| {
        let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let target = caps.get(2).map(|m| m.as_str()).unwrap_or("");

        let file_name = basename_only(target);
        if file_name.is_empty() {
            return placeholder("unknown");
        }

        let cache_path = match resolve_cache_path(state, repo_slug, &file_name) {
            Ok(p) => p,
            Err(_) => return placeholder(&file_name),
        };

        if !cache_path.is_file() {
            return placeholder(&file_name);
        }

        let typst_path = typst_project_image_path(repo_slug, &file_name);
        let typst_path_escaped = escape_typst_string_literal(&typst_path);

        // cmarker only evaluates Typst when `raw-typst: true` and the code is wrapped in
        // `<!--raw-typst ...-->`. Bare `#image(...)` in markdown is emitted as plain text.
        let image_cmd = if let Some(px) = extract_obsidian_width_px(alt) {
            let pt = px_to_pt(px);
            let pt_s = format_pt(pt);
            format!(r#"#image("{typst_path_escaped}", width: {pt_s}pt)"#)
        } else {
            format!(r#"#image("{typst_path_escaped}", width: 100%)"#)
        };
        format!("\n\n<!--raw-typst {image_cmd}-->\n\n")
    })
    .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::new_state(dir.path().to_path_buf());
        (dir, state)
    }

    #[test]
    fn replaces_missing_image_with_placeholder() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let input = "Hello ![image](img_a1b2c3d4.png) world";
        let out = preprocess_markdown_images(&state, repo, input);
        assert!(out.contains("_[Missing Image: img_a1b2c3d4.png]_"));
    }

    #[test]
    fn replaces_existing_image_without_width_with_100_percent() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let cache_dir = asset_store::ensure_cache_dir(&state, repo).unwrap();
        let p = cache_dir.join("img_a1b2c3d4.png");
        std::fs::write(&p, b"png-bytes").unwrap();

        let input = "![image](img_a1b2c3d4.png)";
        let out = preprocess_markdown_images(&state, repo, input);
        assert!(out.contains("<!--raw-typst"));
        assert!(out.contains(r#"width: 100%)"#));
        assert!(out.contains(r#"#image("/assets_cache/myrepo/img_a1b2c3d4.png""#));
        assert!(!out.contains("Missing Image"));
        assert!(!out.contains("/Users/"));
    }

    #[test]
    fn converts_obsidian_width_px_to_points() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let cache_dir = asset_store::ensure_cache_dir(&state, repo).unwrap();
        let p = cache_dir.join("img_a1b2c3d4.png");
        std::fs::write(&p, b"png-bytes").unwrap();

        let input = "![image|400](img_a1b2c3d4.png)";
        let out = preprocess_markdown_images(&state, repo, input);
        // 400px -> 300pt
        assert!(out.contains("<!--raw-typst"));
        assert!(out.contains("width: 300pt"));
    }

    #[test]
    fn drops_path_segments_and_still_resolves_basename() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let cache_dir = asset_store::ensure_cache_dir(&state, repo).unwrap();
        let p = cache_dir.join("img_a1b2c3d4.png");
        std::fs::write(&p, b"png-bytes").unwrap();

        let input = "![image](nested/dir/img_a1b2c3d4.png)";
        let out = preprocess_markdown_images(&state, repo, input);
        assert!(out.contains("<!--raw-typst"));
        assert!(out.contains(r#"/assets_cache/myrepo/img_a1b2c3d4.png"#));
        assert!(!out.contains("Missing Image"));
    }

    #[test]
    fn unsafe_filename_yields_placeholder() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let input = "![image](../etc/passwd)";
        let out = preprocess_markdown_images(&state, repo, input);
        // basename_only => "passwd" which fails validate_file_name
        assert!(out.contains("_[Missing Image: passwd]_"));
    }

    #[test]
    fn pdf_image_width_percent_no_width_is_full_column() {
        assert!((pdf_image_width_percent(None) - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn pdf_image_width_percent_scales_below_max() {
        let pct = pdf_image_width_percent(Some(400.0));
        let expected = (400.0 / MAX_CONTENT_WIDTH_PX) * 100.0;
        assert!((pct - expected).abs() < 0.01);
        assert!(pct < 100.0);
    }

    #[test]
    fn pdf_image_width_percent_caps_at_full_column() {
        assert!((pdf_image_width_percent(Some(800.0)) - 100.0).abs() < f64::EPSILON);
        assert!((pdf_image_width_percent(Some(MAX_CONTENT_WIDTH_PX)) - 100.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn split_body_emits_image_segment_for_cached_file() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let cache_dir = asset_store::ensure_cache_dir(&state, repo).unwrap();
        let p = cache_dir.join("img_a1b2c3d4.png");
        std::fs::write(&p, b"png-bytes").unwrap();

        let segs = split_body_for_pdf(
            &state,
            repo,
            None,
            "Before\n\n![image|400](img_a1b2c3d4.png)\n\nAfter",
        )
        .await;
        let expected_pct = pdf_image_width_percent(Some(400.0));
        assert!(segs.iter().any(|s| matches!(
            s,
            BodySegment::Image {
                path,
                width_percent,
            } if path == "/assets_cache/myrepo/img_a1b2c3d4.png"
                && (*width_percent - expected_pct).abs() < 0.01
        )));
    }

    #[tokio::test]
    async fn split_body_fetches_missing_image_from_local_path_sync() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let repo_path = _dir.path().join("repos").join(repo);
        std::fs::create_dir_all(repo_path.join(".gitoza")).unwrap();

        let local_assets = _dir.path().join("team_assets");
        std::fs::create_dir_all(local_assets.join(repo)).unwrap();
        let file_name = "img_a1b2c3d4.png";
        std::fs::write(local_assets.join(repo).join(file_name), b"png-bytes").unwrap();

        let cfg = crate::project_sync_config::ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: Some(local_assets.to_string_lossy().into_owned()),
            ..Default::default()
        };
        crate::project_sync_config::save_project_sync_config(&repo_path, &cfg).unwrap();

        let segs = split_body_for_pdf(
            &state,
            repo,
            Some(repo_path.as_path()),
            &format!("![image]({file_name})"),
        )
        .await;

        assert!(segs.iter().any(|s| matches!(
            s,
            BodySegment::Image { path, .. } if path == "/assets_cache/myrepo/img_a1b2c3d4.png"
        )));
        assert!(asset_store::cache_hit(&state, repo, file_name));
    }

    #[tokio::test]
    async fn split_body_shows_placeholder_when_remote_missing() {
        let (_dir, state) = temp_state();
        let repo = "myrepo";
        let repo_path = _dir.path().join("repos").join(repo);
        std::fs::create_dir_all(repo_path.join(".gitoza")).unwrap();

        let cfg = crate::project_sync_config::ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: Some(
                _dir.path()
                    .join("empty_assets")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..Default::default()
        };
        crate::project_sync_config::save_project_sync_config(&repo_path, &cfg).unwrap();

        let segs = split_body_for_pdf(
            &state,
            repo,
            Some(repo_path.as_path()),
            "![image](img_a1b2c3d4.png)",
        )
        .await;

        assert!(segs.iter().any(|s| matches!(
            s,
            BodySegment::Markdown(text) if text.contains("_[Missing Image: img_a1b2c3d4.png]_")
        )));
    }
}
