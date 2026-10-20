//! Case ID minting: per-project `case_prefix` in `.project.md` + `TC-{PREFIX}-{6}` ids.
//! Stem uniqueness is global across cases and tickets in the repo.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::{atomic_write_file, is_valid_case_id, CASES_ARCHIVE_DIR, CASES_PREFIX};

const PROJECT_META_FILE: &str = ".project.md";
const CASE_ID_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CASE_ID_SUFFIX_LEN: usize = 6;
const MINT_TRIES: usize = 64;
/// Fixed kind marker so case ids are distinct from tickets (`{PREFIX}-{6}`).
pub(crate) const CASE_KIND_PREFIX: &str = "TC";
/// Mirror of tickets root (avoid importing `tickets` — that module calls into this one).
const TICKETS_ROOT_REL: &str = ".gitoza/tasks/tickets";

fn is_valid_case_prefix(prefix: &str) -> bool {
    let s = prefix.trim();
    !s.is_empty()
        && s.len() <= 12
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

fn derive_prefix_stem(project_name: &str) -> String {
    let alnum: String = project_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if alnum.is_empty() {
        "CASE".to_string()
    } else {
        alnum
    }
}

fn derive_prefix_candidate(project_name: &str) -> String {
    let stem = derive_prefix_stem(project_name);
    if stem.len() >= 4 {
        stem.chars().take(4).collect()
    } else if stem.len() >= 2 {
        stem
    } else {
        let mut s = stem;
        while s.len() < 2 {
            s.push('X');
        }
        s
    }
}

fn random_alnum_suffix(len: usize) -> String {
    let mut out = String::with_capacity(len);
    while out.len() < len {
        let u = uuid::Uuid::new_v4();
        for b in u.as_bytes() {
            if out.len() >= len {
                break;
            }
            out.push(CASE_ID_ALPHABET[(*b as usize) % CASE_ID_ALPHABET.len()] as char);
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CaseProjectMeta {
    pub case_prefix: String,
}

fn read_case_project_meta(project_dir: &Path) -> Option<CaseProjectMeta> {
    let path = project_dir.join(PROJECT_META_FILE);
    let raw = std::fs::read_to_string(&path).ok()?;
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return None;
    }
    let rest = &stripped[3..];
    let front_text = match rest.find("\n---") {
        Some(idx) => &rest[..idx],
        None => rest,
    };
    let val: serde_yaml::Value = serde_yaml::from_str(front_text).ok()?;
    let prefix = val
        .get("case_prefix")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_ascii_uppercase())
        .filter(|s| is_valid_case_prefix(s))?;
    Some(CaseProjectMeta {
        case_prefix: prefix,
    })
}

fn write_case_project_meta(project_dir: &Path, meta: &CaseProjectMeta) -> Result<()> {
    std::fs::create_dir_all(project_dir)?;
    let path = project_dir.join(PROJECT_META_FILE);
    let mut map = serde_yaml::Mapping::new();
    map.insert(
        serde_yaml::Value::String("case_prefix".to_string()),
        serde_yaml::Value::String(meta.case_prefix.clone()),
    );
    let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(map))
        .context("serialize case project meta")?;
    let header = yaml.trim_start_matches("---\n");
    let body = format!("---\n{header}---\n\n");
    atomic_write_file(&path, body.as_bytes())
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Absolute path to an **active** case project's root directory.
pub(crate) fn case_project_dir(repo_path: &Path, project: &str) -> PathBuf {
    repo_path
        .join(CASES_PREFIX.trim_end_matches('/'))
        .join(project.trim())
}

/// Project root on disk for a cases directory path (handles `.archive/<project>/…`).
pub(crate) fn case_project_dir_from_directory(
    repo_path: &Path,
    directory: &str,
) -> Result<PathBuf> {
    let project = project_name_from_cases_directory(directory)?;
    let norm = directory.trim().replace('\\', "/");
    let norm = norm.trim_start_matches('/').trim_end_matches('/');
    let after = norm
        .strip_prefix(CASES_PREFIX.trim_end_matches('/'))
        .unwrap_or("")
        .trim_start_matches('/');
    if after.starts_with(CASES_ARCHIVE_DIR) {
        return Ok(repo_path
            .join(CASES_PREFIX.trim_end_matches('/'))
            .join(CASES_ARCHIVE_DIR)
            .join(project));
    }
    Ok(case_project_dir(repo_path, &project))
}

/// Project folder name from a cases directory path (`.gitoza/test/cases/<project>[/…]`).
pub(crate) fn project_name_from_cases_directory(directory: &str) -> Result<String> {
    let norm = directory.trim().replace('\\', "/");
    let norm = norm.trim_start_matches('/').trim_end_matches('/');
    if !norm.starts_with(CASES_PREFIX.trim_end_matches('/')) {
        anyhow::bail!("Directory must be under .gitoza/test/cases/");
    }
    let after = norm
        .strip_prefix(CASES_PREFIX.trim_end_matches('/'))
        .unwrap_or("")
        .trim_start_matches('/');
    if after.is_empty() {
        anyhow::bail!("Missing case project in directory path");
    }
    let mut parts = after.split('/');
    let first = parts.next().unwrap_or("").trim();
    if first.is_empty() || first == CASES_ARCHIVE_DIR {
        // `.archive/<project>/…`
        if first == CASES_ARCHIVE_DIR {
            let proj = parts.next().unwrap_or("").trim();
            if proj.is_empty() {
                anyhow::bail!("Missing archived case project name");
            }
            return Ok(proj.to_string());
        }
        anyhow::bail!("Invalid case project directory");
    }
    Ok(first.to_string())
}

/// Collect `case_prefix` values from sibling case projects (active + archived).
fn collected_case_prefixes(repo_path: &Path, exclude_project: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let cases_root = repo_path.join(CASES_PREFIX.trim_end_matches('/'));
    collect_prefixes_in_root(&cases_root, exclude_project, false, &mut out);
    let archive_root = cases_root.join(CASES_ARCHIVE_DIR);
    if archive_root.is_dir() {
        collect_prefixes_in_root(&archive_root, exclude_project, true, &mut out);
    }
    out
}

fn collect_prefixes_in_root(
    root: &Path,
    exclude_project: &str,
    _archived_shelf: bool,
    out: &mut Vec<(String, String)>,
) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = ent.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if name == CASES_ARCHIVE_DIR || name.starts_with('.') {
            continue;
        }
        if name == exclude_project {
            continue;
        }
        if let Some(meta) = read_case_project_meta(&path) {
            out.push((name, meta.case_prefix));
        }
    }
}

fn prefix_taken_by_other(repo_path: &Path, project: &str, prefix: &str) -> bool {
    collected_case_prefixes(repo_path, project)
        .into_iter()
        .any(|(_, p)| p.eq_ignore_ascii_case(prefix))
}

fn allocate_case_prefix(repo_path: &Path, project_name: &str) -> Result<String> {
    let stem = derive_prefix_stem(project_name);
    let primary = derive_prefix_candidate(project_name);
    let mut candidates: Vec<String> = vec![primary.clone()];
    for n in 2u8..=9 {
        candidates.push(format!("{primary}{n}"));
    }
    for take in 5..=stem.len().min(8) {
        candidates.push(stem.chars().take(take).collect());
    }
    for c in &candidates {
        if is_valid_case_prefix(c) && !prefix_taken_by_other(repo_path, project_name, c) {
            return Ok(c.clone());
        }
    }
    for _ in 0..32 {
        let c = random_alnum_suffix(4);
        if !prefix_taken_by_other(repo_path, project_name, &c) {
            return Ok(c);
        }
    }
    anyhow::bail!("Failed to allocate unique case prefix for project '{project_name}'")
}

/// Ensure project has `case_prefix` on disk; returns the prefix.
/// `project_dir` must be the project root (active or under `.archive/`).
pub(crate) fn ensure_case_prefix_at(repo_path: &Path, project: &str, project_dir: &Path) -> Result<String> {
    let project = project.trim();
    if project.is_empty() {
        anyhow::bail!("Invalid case project name");
    }
    if !project_dir.is_dir() {
        anyhow::bail!("Case project directory not found: {project}");
    }
    if let Some(meta) = read_case_project_meta(project_dir) {
        if !prefix_taken_by_other(repo_path, project, &meta.case_prefix) {
            return Ok(meta.case_prefix);
        }
        let prefix = allocate_case_prefix(repo_path, project)?;
        write_case_project_meta(
            project_dir,
            &CaseProjectMeta {
                case_prefix: prefix.clone(),
            },
        )?;
        return Ok(prefix);
    }
    let prefix = allocate_case_prefix(repo_path, project)?;
    write_case_project_meta(
        project_dir,
        &CaseProjectMeta {
            case_prefix: prefix.clone(),
        },
    )?;
    Ok(prefix)
}

/// Ensure prefix for a cases directory path (project or nested suite).
pub(crate) fn ensure_case_prefix_for_directory(repo_path: &Path, directory: &str) -> Result<String> {
    let project = project_name_from_cases_directory(directory)?;
    let project_dir = case_project_dir_from_directory(repo_path, directory)?;
    ensure_case_prefix_at(repo_path, &project, &project_dir)
}

/// Ensure prefix for an active project folder name.
#[cfg(test)]
pub(crate) fn ensure_case_prefix(repo_path: &Path, project: &str) -> Result<String> {
    let project_dir = case_project_dir(repo_path, project);
    ensure_case_prefix_at(repo_path, project, &project_dir)
}

/// Write `.project.md` when creating a new case project directory.
pub(crate) fn init_case_project_meta(repo_path: &Path, project: &str) -> Result<String> {
    let project = project.trim();
    let project_dir = case_project_dir(repo_path, project);
    std::fs::create_dir_all(&project_dir)?;
    if let Some(meta) = read_case_project_meta(&project_dir) {
        return Ok(meta.case_prefix);
    }
    let prefix = allocate_case_prefix(repo_path, project)?;
    write_case_project_meta(
        &project_dir,
        &CaseProjectMeta {
            case_prefix: prefix.clone(),
        },
    )?;
    Ok(prefix)
}

fn case_id_taken_in_db(conn: &Connection, slug: &str, case_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM test_cases WHERE repo_slug = ?1 AND case_id = ?2 LIMIT 1",
        params![slug, case_id],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn ticket_id_taken_in_db(conn: &Connection, slug: &str, ticket_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM tickets WHERE repo_slug = ?1 AND ticket_id = ?2 LIMIT 1",
        params![slug, ticket_id],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn md_stem_exists_under(root: &Path, stem: &str) -> bool {
    fn walk(dir: &Path, needle: &str) -> bool {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return false;
        };
        for ent in rd.flatten() {
            let path = ent.path();
            if path.is_dir() {
                if walk(&path, needle) {
                    return true;
                }
                continue;
            }
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if name.eq_ignore_ascii_case(PROJECT_META_FILE) {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if path.file_stem().and_then(|s| s.to_str()) == Some(needle) {
                return true;
            }
        }
        false
    }
    if !root.is_dir() {
        return false;
    }
    walk(root, stem)
}

/// True if `id` is already used as a case or ticket stem in this repo (DB or disk).
pub(crate) fn entity_id_taken_in_repo(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    id: &str,
) -> bool {
    if case_id_taken_in_db(conn, slug, id) || ticket_id_taken_in_db(conn, slug, id) {
        return true;
    }
    let cases_root = repo_path.join(CASES_PREFIX.trim_end_matches('/'));
    if md_stem_exists_under(&cases_root, id) {
        return true;
    }
    let tickets_root = repo_path.join(TICKETS_ROOT_REL);
    md_stem_exists_under(&tickets_root, id)
}

/// True if `case_id` is already used in the repo (cases or tickets).
pub(crate) fn case_id_taken_in_repo(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    case_id: &str,
) -> bool {
    entity_id_taken_in_repo(conn, repo_path, slug, case_id)
}

/// Generate `TC-{PREFIX}-{6}` not used by any case or ticket in the repo.
pub(crate) fn generate_unique_case_id(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    prefix: &str,
) -> Result<String> {
    for _ in 0..MINT_TRIES {
        let id = format!(
            "{CASE_KIND_PREFIX}-{prefix}-{}",
            random_alnum_suffix(CASE_ID_SUFFIX_LEN)
        );
        if !is_valid_case_id(&id) {
            continue;
        }
        if entity_id_taken_in_repo(conn, repo_path, slug, &id) {
            continue;
        }
        return Ok(id);
    }
    anyhow::bail!("Failed to allocate unique case id for prefix '{prefix}'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn project_name_from_nested_directory() {
        assert_eq!(
            project_name_from_cases_directory(".gitoza/test/cases/pay/suite_a").unwrap(),
            "pay"
        );
        assert_eq!(
            project_name_from_cases_directory(".gitoza/test/cases/.archive/pay/x").unwrap(),
            "pay"
        );
    }

    fn open_entity_tables() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE test_cases (
               case_id TEXT NOT NULL,
               file_path TEXT NOT NULL,
               repo_slug TEXT NOT NULL,
               PRIMARY KEY (repo_slug, file_path)
             );
             CREATE TABLE tickets (
               ticket_id TEXT NOT NULL,
               file_path TEXT NOT NULL,
               repo_slug TEXT NOT NULL,
               PRIMARY KEY (repo_slug, file_path)
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn ensure_prefix_and_mint_unique() {
        let tmp = tempdir().unwrap();
        let repo = tmp.path();
        let proj = "payments";
        std::fs::create_dir_all(case_project_dir(repo, proj)).unwrap();
        let prefix = ensure_case_prefix(repo, proj).unwrap();
        assert!(is_valid_case_prefix(&prefix));
        assert!(prefix.len() >= 2);

        let meta_path = case_project_dir(repo, proj).join(PROJECT_META_FILE);
        assert!(meta_path.is_file());

        let conn = open_entity_tables();
        let id1 = generate_unique_case_id(&conn, repo, "slug", &prefix).unwrap();
        let expected_prefix = format!("{CASE_KIND_PREFIX}-{prefix}-");
        assert!(id1.starts_with(&expected_prefix));
        assert_eq!(
            id1.len(),
            CASE_KIND_PREFIX.len() + 1 + prefix.len() + 1 + CASE_ID_SUFFIX_LEN
        );

        // Occupy id1 on disk; next mint must differ.
        std::fs::write(
            case_project_dir(repo, proj).join(format!("{id1}.md")),
            "---\ntitle: x\n---\n",
        )
        .unwrap();
        let id2 = generate_unique_case_id(&conn, repo, "slug", &prefix).unwrap();
        assert_ne!(id1, id2);
        assert!(id2.starts_with(&expected_prefix));
    }

    #[test]
    fn mint_skips_stem_taken_by_ticket_on_disk() {
        let tmp = tempdir().unwrap();
        let repo = tmp.path();
        let proj = "pay";
        std::fs::create_dir_all(case_project_dir(repo, proj)).unwrap();
        let prefix = ensure_case_prefix(repo, proj).unwrap();
        let conn = open_entity_tables();

        // Force collision path: plant a ticket with the next minted id is hard;
        // instead plant a specific TC-… stem and assert entity_id_taken blocks it.
        let blocker = format!("{CASE_KIND_PREFIX}-{prefix}-AAAAAA");
        let tickets_proj = repo.join(TICKETS_ROOT_REL).join("pay");
        std::fs::create_dir_all(&tickets_proj).unwrap();
        std::fs::write(tickets_proj.join(format!("{blocker}.md")), "---\ntitle: t\n---\n").unwrap();
        assert!(entity_id_taken_in_repo(&conn, repo, "slug", &blocker));

        let minted = generate_unique_case_id(&conn, repo, "slug", &prefix).unwrap();
        assert_ne!(minted, blocker);
        assert!(minted.starts_with(&format!("{CASE_KIND_PREFIX}-{prefix}-")));
    }

    #[test]
    fn two_projects_get_distinct_prefixes() {
        let tmp = tempdir().unwrap();
        let repo = tmp.path();
        std::fs::create_dir_all(case_project_dir(repo, "auth")).unwrap();
        std::fs::create_dir_all(case_project_dir(repo, "auth_copy")).unwrap();
        // Same 4-char stem AUTH — second should get AUTH2 or longer variant.
        let p1 = ensure_case_prefix(repo, "auth").unwrap();
        let p2 = ensure_case_prefix(repo, "auth_copy").unwrap();
        assert_ne!(p1, p2);
    }
}
