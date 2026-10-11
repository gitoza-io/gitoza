use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;

/// Rust equivalent of `app/services/file_truth_framework.py`.
///
/// YAML on disk is the source of truth; SQLite is a derived index/cache.
pub trait EntityIndexer {
    type Entity;

    /// Return all YAML files for this entity type under repo_path.
    fn discover_files(&self, repo_path: &Path) -> Vec<PathBuf>;

    /// Parse one YAML file. Returns (entity_id, entity) on success.
    ///
    /// `entity_id` is used for stale removal (file_path for Cases, run_id for Runs).
    fn parse_file(
        &self,
        file_path: &Path,
        repo_path: &Path,
        repo_slug: &str,
    ) -> Result<Option<(String, Self::Entity)>>;

    /// Upsert parsed entities into DB. Returns count upserted.
    fn upsert_entities(&self, repo_slug: &str, entities: &[Self::Entity]) -> Result<i64>;

    /// Remove DB rows whose IDs are not in `current_ids`. Returns count removed.
    fn remove_stale(&self, repo_slug: &str, current_ids: &HashSet<String>) -> Result<i64>;

    /// Optional hook after indexing.
    fn post_index(
        &self,
        _repo_path: &Path,
        _repo_slug: &str,
        _entities: &[Self::Entity],
    ) -> Result<()> {
        Ok(())
    }
}

pub struct IndexStats {
    pub indexed: i64,
    pub errors: i64,
    pub removed: i64,
}

pub fn index_entities_full<I: EntityIndexer>(
    repo_path: &Path,
    repo_slug: &str,
    indexer: &I,
) -> Result<IndexStats> {
    let files = indexer.discover_files(repo_path);
    let mut current_ids: HashSet<String> = HashSet::new();
    let mut entities: Vec<I::Entity> = Vec::new();
    let mut errors: i64 = 0;

    for f in files {
        match indexer.parse_file(&f, repo_path, repo_slug)? {
            Some((eid, ent)) => {
                if !eid.trim().is_empty() {
                    current_ids.insert(eid);
                }
                entities.push(ent);
            }
            None => {
                errors += 1;
            }
        }
    }

    let indexed = indexer.upsert_entities(repo_slug, &entities)?;
    let removed = indexer.remove_stale(repo_slug, &current_ids)?;
    indexer.post_index(repo_path, repo_slug, &entities)?;

    Ok(IndexStats {
        indexed,
        errors,
        removed,
    })
}
