//! Pure conflict classification from Git unmerged index stages and working-tree text.
//!
//! During rebase onto upstream, stage 2 = shared (already synced) and stage 3 = yours.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictClassification {
    pub kind: String,
    pub shared_deleted: bool,
    pub your_content: Option<String>,
    pub shared_content: Option<String>,
    pub your_path: Option<String>,
    pub shared_path: Option<String>,
    pub base_path: Option<String>,
    pub has_content_conflict: bool,
    /// Other unmerged paths tied to this rename group (for resolution).
    pub related_paths: Vec<String>,
}

impl ConflictClassification {
    pub fn content_default() -> Self {
        Self {
            kind: "content".to_string(),
            shared_deleted: false,
            your_content: None,
            shared_content: None,
            your_path: None,
            shared_path: None,
            base_path: None,
            has_content_conflict: false,
            related_paths: vec![],
        }
    }

    pub fn unknown() -> Self {
        Self {
            kind: "unknown".to_string(),
            ..Self::content_default()
        }
    }
}

/// Per-path stage map: stage number -> object hash.
pub type PathStages = HashMap<String, HashMap<u8, String>>;

/// Parsed rename/rename group linked by shared stage-1 blob hash (and leaf expansion).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameGroup {
    pub shared_path: String,
    pub your_path: String,
    pub base_path: Option<String>,
    pub related_paths: Vec<String>,
}

/// Parse `git ls-files -u` output into a path -> stages map.
pub fn parse_ls_files_unmerged(output: &str) -> PathStages {
    let mut map: PathStages = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        let stage: u8 = parts[2].parse().unwrap_or(0);
        if !(1..=3).contains(&stage) {
            continue;
        }
        let object = parts[1].to_string();
        let path = parts[3].replace('\\', "/");
        map.entry(path).or_default().insert(stage, object);
    }
    map
}

pub fn has_conflict_markers(content: &str) -> bool {
    content.contains("<<<<<<< ")
}

fn stages_for(path: &str, all: &PathStages) -> HashMap<u8, String> {
    all.get(path).cloned().unwrap_or_default()
}

/// Leaf stem after stripping dirs and `.yaml`/`.yml`/`.md` (mirrors frontend `pathLeafName`).
pub fn path_leaf_name(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let base = normalized
        .rsplit('/')
        .next()
        .unwrap_or(normalized.as_str())
        .to_string();
    let lower = base.to_lowercase();
    let stem = if lower.ends_with(".yaml") {
        base[..base.len().saturating_sub(5)].to_string()
    } else if lower.ends_with(".yml") {
        base[..base.len().saturating_sub(4)].to_string()
    } else if lower.ends_with(".md") {
        base[..base.len().saturating_sub(3)].to_string()
    } else {
        base
    };
    if stem.is_empty() {
        path.to_string()
    } else {
        stem
    }
}

/// Stage-1 blob hash for a path, if present in the unmerged index.
pub fn stage1_hash(path: &str, all: &PathStages) -> Option<String> {
    stage_object_hash(path, 1, all)
}

/// Git object hash for a path at the given unmerged stage (1–3).
pub fn stage_object_hash(path: &str, stage: u8, all: &PathStages) -> Option<String> {
    all.get(path).and_then(|stages| stages.get(&stage).cloned())
}

/// True when stage-2 and stage-3 blobs are identical (pure path rename).
pub fn rename_group_hashes_match(group: &RenameGroup, all: &PathStages) -> bool {
    match (
        stage_object_hash(&group.shared_path, 2, all),
        stage_object_hash(&group.your_path, 3, all),
    ) {
        (Some(h2), Some(h3)) => h2 == h3,
        _ => false,
    }
}

/// All unmerged paths whose stage-1 blob hash equals `hash`.
pub fn paths_with_stage1_hash(hash: &str, all: &PathStages) -> Vec<String> {
    let mut out: Vec<String> = all
        .iter()
        .filter(|(_, stages)| stages.get(&1).map(|h| h == hash).unwrap_or(false))
        .map(|(p, _)| p.clone())
        .collect();
    out.sort();
    out
}

fn resolve_stage1_hash_for_path(path: &str, all: &PathStages) -> Option<String> {
    if let Some(hash) = stage1_hash(path, all) {
        return Some(hash);
    }
    let leaf = path_leaf_name(path);
    let mut matches: Vec<String> = all
        .iter()
        .filter(|(p, stages)| path_leaf_name(p) == leaf && stages.contains_key(&1))
        .filter_map(|(_, stages)| stages.get(&1).cloned())
        .collect();
    matches.sort();
    matches.dedup();
    matches.into_iter().next()
}

fn collect_rename_group_paths(path: &str, base_hash: &str, all: &PathStages) -> HashSet<String> {
    let mut group: HashSet<String> = paths_with_stage1_hash(base_hash, all).into_iter().collect();
    let mut leaves: HashSet<String> = group.iter().map(|p| path_leaf_name(p)).collect();
    leaves.insert(path_leaf_name(path));
    for (p, stages) in all {
        if leaves.contains(&path_leaf_name(p))
            && (stages.contains_key(&1) || stages.contains_key(&2) || stages.contains_key(&3))
        {
            group.insert(p.clone());
        }
    }
    group
}

fn singleton_rename_fallback(all: &PathStages) -> Option<(String, String)> {
    let stage2_paths: Vec<String> = all
        .iter()
        .filter(|(_, stages)| stages.contains_key(&2))
        .map(|(p, _)| p.clone())
        .collect();
    let stage3_paths: Vec<String> = all
        .iter()
        .filter(|(_, stages)| stages.contains_key(&3))
        .map(|(p, _)| p.clone())
        .collect();
    if stage2_paths.len() == 1 && stage3_paths.len() == 1 && stage2_paths[0] != stage3_paths[0] {
        Some((stage2_paths[0].clone(), stage3_paths[0].clone()))
    } else {
        None
    }
}

/// Pair stage-2 and stage-3 paths for a rename/rename conflict using shared stage-1 grouping.
pub fn resolve_rename_group(path: &str, all: &PathStages) -> Option<RenameGroup> {
    if let Some(base_hash) = resolve_stage1_hash_for_path(path, all) {
        let group = collect_rename_group_paths(path, &base_hash, all);
        let shared_path = group
            .iter()
            .find(|p| stages_for(p, all).contains_key(&2))
            .cloned();
        let your_path = group
            .iter()
            .find(|p| stages_for(p, all).contains_key(&3))
            .cloned();
        if let (Some(shared_path), Some(your_path)) = (shared_path, your_path) {
            if shared_path != your_path {
                let base_path = group
                    .iter()
                    .find(|p| {
                        let s = stages_for(p, all);
                        s.contains_key(&1) && !s.contains_key(&2) && !s.contains_key(&3)
                    })
                    .cloned()
                    .or_else(|| {
                        group
                            .iter()
                            .find(|p| stages_for(p, all).contains_key(&1))
                            .cloned()
                    });
                let mut related: Vec<String> = group.into_iter().collect();
                related.sort();
                return Some(RenameGroup {
                    shared_path,
                    your_path,
                    base_path,
                    related_paths: related,
                });
            }
        }
    }

    if resolve_stage1_hash_for_path(path, all).is_none()
        && !all.values().any(|stages| stages.contains_key(&1))
    {
        if let Some((shared_path, your_path)) = singleton_rename_fallback(all) {
            let mut related = vec![shared_path.clone(), your_path.clone(), path.to_string()];
            related.sort();
            related.dedup();
            return Some(RenameGroup {
                shared_path,
                your_path,
                base_path: None,
                related_paths: related,
            });
        }
    }

    git_rename_rename_group(all)
}

/// Git `rename/rename` index: stage 1 on the old path, stage 2 on shared's name, stage 3 on yours.
fn git_rename_rename_group(all: &PathStages) -> Option<RenameGroup> {
    let stage1_only: Vec<String> = all
        .iter()
        .filter(|(_, s)| s.contains_key(&1) && !s.contains_key(&2) && !s.contains_key(&3))
        .map(|(p, _)| p.clone())
        .collect();
    let stage2_only: Vec<String> = all
        .iter()
        .filter(|(_, s)| s.contains_key(&2) && !s.contains_key(&1) && !s.contains_key(&3))
        .map(|(p, _)| p.clone())
        .collect();
    let stage3_only: Vec<String> = all
        .iter()
        .filter(|(_, s)| s.contains_key(&3) && !s.contains_key(&1) && !s.contains_key(&2))
        .map(|(p, _)| p.clone())
        .collect();
    if stage1_only.len() == 1 && stage2_only.len() == 1 && stage3_only.len() == 1 {
        let mut related = vec![
            stage1_only[0].clone(),
            stage2_only[0].clone(),
            stage3_only[0].clone(),
        ];
        related.sort();
        return Some(RenameGroup {
            shared_path: stage2_only[0].clone(),
            your_path: stage3_only[0].clone(),
            base_path: Some(stage1_only[0].clone()),
            related_paths: related,
        });
    }
    None
}

/// Remote new path when upstream deleted/moved away from `conflict_path`.
/// Returns a different unmerged path that has stage 2 (shared/upstream side).
pub fn find_companion_shared_path(conflict_path: &str, all_stages: &PathStages) -> Option<String> {
    let conflict_stages = stages_for(conflict_path, all_stages);
    let conflict_leaf = path_leaf_name(conflict_path);

    if let Some(hash) = conflict_stages.get(&1) {
        if let Some(found) = all_stages
            .iter()
            .filter(|(p, stages)| {
                p.as_str() != conflict_path
                    && stages.contains_key(&2)
                    && stages.get(&1).map(|h| h == hash).unwrap_or(false)
            })
            .map(|(p, _)| p.clone())
            .min()
        {
            return Some(found);
        }
    }

    if let Some(found) = all_stages
        .iter()
        .filter(|(p, stages)| {
            p.as_str() != conflict_path
                && stages.contains_key(&2)
                && path_leaf_name(p) == conflict_leaf
        })
        .map(|(p, _)| p.clone())
        .min()
    {
        return Some(found);
    }

    let stage2_paths: Vec<String> = all_stages
        .iter()
        .filter(|(p, stages)| p.as_str() != conflict_path && stages.contains_key(&2))
        .map(|(p, _)| p.clone())
        .collect();
    if stage2_paths.len() == 1 {
        return Some(stage2_paths[0].clone());
    }

    None
}

/// Returns `(stage_2_path, stage_3_path)` for loading blob content during conflict read.
pub fn stage_paths_for_content(path: &str, all: &PathStages) -> (Option<String>, Option<String>) {
    let stages = stages_for(path, all);
    let has_1 = stages.contains_key(&1);
    let has_2 = stages.contains_key(&2);
    let has_3 = stages.contains_key(&3);

    if has_1 && has_3 && !has_2 {
        return (
            find_companion_shared_path(path, all),
            Some(path.to_string()),
        );
    }

    if has_1 && has_2 && !has_3 {
        return (Some(path.to_string()), Some(path.to_string()));
    }

    if let Some(group) = resolve_rename_group(path, all) {
        return (Some(group.shared_path), Some(group.your_path));
    }

    let stage_2_path = if has_2 { Some(path.to_string()) } else { None };
    let stage_3_path = if has_3 { Some(path.to_string()) } else { None };
    (stage_2_path, stage_3_path)
}

/// Classify a stage-1 paired group as rename (matching hashes) or modify_delete (mismatch).
pub fn classification_from_rename_group(
    group: RenameGroup,
    working_tree: &str,
    stage_2_content: Option<&str>,
    stage_3_content: Option<&str>,
    all: &PathStages,
) -> ConflictClassification {
    if rename_group_hashes_match(&group, all) {
        return ConflictClassification {
            kind: "rename".to_string(),
            your_path: Some(group.your_path),
            shared_path: Some(group.shared_path),
            base_path: group.base_path,
            related_paths: group.related_paths,
            ..ConflictClassification::content_default()
        };
    }

    let your = if !working_tree.is_empty() {
        working_tree.to_string()
    } else {
        stage_3_content.unwrap_or("").to_string()
    };
    ConflictClassification {
        kind: "modify_delete".to_string(),
        shared_deleted: true,
        your_content: Some(your),
        shared_content: stage_2_content.map(|s| s.to_string()),
        shared_path: Some(group.shared_path),
        ..ConflictClassification::content_default()
    }
}

/// Classify a single unmerged path.
pub fn classify_conflict(
    path: &str,
    working_tree: &str,
    all_stages: &PathStages,
    stage_2_content: Option<&str>,
    stage_3_content: Option<&str>,
) -> ConflictClassification {
    if has_conflict_markers(working_tree) {
        return ConflictClassification {
            kind: "content".to_string(),
            ..ConflictClassification::content_default()
        };
    }

    let stages = stages_for(path, all_stages);
    let has_1 = stages.contains_key(&1);
    let has_2 = stages.contains_key(&2);
    let has_3 = stages.contains_key(&3);

    // Modify/delete on this path takes priority over cross-path rename detection
    // (e.g. remote moved to new path + you edited old path), except when the stage-2
    // partner also carries stage 1 (both sides renamed from the same base).
    if has_1 && has_3 && !has_2 {
        if let Some(companion) = find_companion_shared_path(path, all_stages) {
            let companion_has_stage1 = stages_for(&companion, all_stages).contains_key(&1);
            if companion_has_stage1 {
                if let Some(group) = resolve_rename_group(path, all_stages) {
                    return classification_from_rename_group(
                        group,
                        working_tree,
                        stage_2_content,
                        stage_3_content,
                        all_stages,
                    );
                }
            }
        }

        let your = if !working_tree.is_empty() {
            working_tree.to_string()
        } else {
            stage_3_content.unwrap_or("").to_string()
        };
        let companion = find_companion_shared_path(path, all_stages);
        return ConflictClassification {
            kind: "modify_delete".to_string(),
            shared_deleted: true,
            your_content: Some(your),
            shared_content: stage_2_content.map(|s| s.to_string()),
            shared_path: companion,
            ..ConflictClassification::content_default()
        };
    }

    if has_1 && has_2 && !has_3 {
        return ConflictClassification {
            kind: "modify_delete".to_string(),
            shared_deleted: false,
            your_content: Some(if !working_tree.is_empty() {
                working_tree.to_string()
            } else {
                stage_3_content.unwrap_or("").to_string()
            }),
            shared_content: stage_2_content.map(|s| s.to_string()),
            ..ConflictClassification::content_default()
        };
    }

    if let Some(group) = resolve_rename_group(path, all_stages) {
        return classification_from_rename_group(
            group,
            working_tree,
            stage_2_content,
            stage_3_content,
            all_stages,
        );
    }

    if has_1 && has_2 && has_3 {
        if has_conflict_markers(working_tree) {
            return ConflictClassification {
                kind: "content".to_string(),
                ..ConflictClassification::content_default()
            };
        }
        let s2 = stage_2_content.unwrap_or("");
        let s3 = stage_3_content.unwrap_or("");
        if s2 != s3 {
            return ConflictClassification {
                kind: "content".to_string(),
                ..ConflictClassification::content_default()
            };
        }
    }

    ConflictClassification::unknown()
}

fn group_dedupe_key(group: &RenameGroup) -> String {
    let mut group_key = group.related_paths.clone();
    group_key.sort();
    group_key.join("\0")
}

/// Paths that should appear in conflict list (dedupe rename groups to one primary path).
pub fn primary_paths_for_conflicts(paths: &[String], all_stages: &PathStages) -> Vec<String> {
    let mut seen_paired_groups: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    let mut emitted: HashSet<String> = HashSet::new();
    let mut seen_input: HashSet<String> = HashSet::new();

    for path in paths {
        if !seen_input.insert(path.clone()) {
            continue;
        }
        if let Some(group) = resolve_rename_group(path, all_stages) {
            let key = group_dedupe_key(&group);
            if seen_paired_groups.insert(key) {
                let primary = group.your_path.clone();
                if emitted.insert(primary.clone()) {
                    out.push(primary);
                }
            }
            continue;
        }
        if emitted.insert(path.clone()) {
            out.push(path.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stages_map(entries: &[(&str, u8, &str)]) -> PathStages {
        let mut map: PathStages = HashMap::new();
        for (path, stage, obj) in entries {
            map.entry((*path).to_string())
                .or_default()
                .insert(*stage, (*obj).to_string());
        }
        map
    }

    #[test]
    fn path_leaf_name_strips_extension() {
        assert_eq!(path_leaf_name("proj/suite/TLS-0019.yaml"), "TLS-0019");
        assert_eq!(path_leaf_name("run/foo.yml"), "foo");
        assert_eq!(path_leaf_name("tpl/body.md"), "body");
    }

    #[test]
    fn detects_content_from_markers() {
        let content = "a\n<<<<<<< HEAD\nr\n=======\nm\n>>>>>>> b\n";
        let c = classify_conflict("f.yaml", content, &HashMap::new(), None, None);
        assert_eq!(c.kind, "content");
    }

    #[test]
    fn detects_modify_delete_shared_deleted() {
        let all = stages_map(&[("case.yaml", 1, "aaa"), ("case.yaml", 3, "bbb")]);
        let c = classify_conflict("case.yaml", "my edit", &all, None, Some("my edit"));
        assert_eq!(c.kind, "modify_delete");
        assert!(c.shared_deleted);
        assert_eq!(c.your_content.as_deref(), Some("my edit"));
    }

    #[test]
    fn detects_modify_delete_user_deleted() {
        let all = stages_map(&[("case.yaml", 1, "aaa"), ("case.yaml", 2, "bbb")]);
        let c = classify_conflict("case.yaml", "", &all, Some("shared edit"), None);
        assert_eq!(c.kind, "modify_delete");
        assert!(!c.shared_deleted);
        assert_eq!(c.shared_content.as_deref(), Some("shared edit"));
    }

    #[test]
    fn detects_rename_divergence() {
        let all = stages_map(&[
            ("old/case.yaml", 1, "base"),
            ("shared/case.yaml", 2, "obj2"),
            ("your/case.yaml", 3, "obj3"),
        ]);
        let c = classify_conflict(
            "your/case.yaml",
            "",
            &all,
            Some("shared body"),
            Some("your body"),
        );
        assert_eq!(c.kind, "modify_delete");
        assert!(c.shared_deleted);
        assert_eq!(c.shared_path.as_deref(), Some("shared/case.yaml"));
        assert!(!c.has_content_conflict);
    }

    #[test]
    fn same_hash_paired_paths_is_rename() {
        let all = stages_map(&[
            ("old/case.yaml", 1, "base"),
            ("shared/case.yaml", 2, "same"),
            ("your/case.yaml", 3, "same"),
        ]);
        let c = classify_conflict("your/case.yaml", "", &all, Some("body"), Some("body"));
        assert_eq!(c.kind, "rename");
        assert_eq!(c.shared_path.as_deref(), Some("shared/case.yaml"));
        assert_eq!(c.your_path.as_deref(), Some("your/case.yaml"));
        assert!(!c.has_content_conflict);
    }

    #[test]
    fn git_rename_rename_different_basenames_is_rename() {
        let all = stages_map(&[
            ("notes.md", 1, "same"),
            ("shared.md", 2, "same"),
            ("yours.md", 3, "same"),
        ]);
        let c = classify_conflict(
            "yours.md",
            "same body\n",
            &all,
            Some("same body\n"),
            Some("same body\n"),
        );
        assert_eq!(c.kind, "rename");
        assert_eq!(c.shared_path.as_deref(), Some("shared.md"));
        assert_eq!(c.your_path.as_deref(), Some("yours.md"));
        assert_eq!(c.base_path.as_deref(), Some("notes.md"));
        let primaries = primary_paths_for_conflicts(
            &["notes.md".into(), "shared.md".into(), "yours.md".into()],
            &all,
        );
        assert_eq!(primaries, vec!["yours.md".to_string()]);
    }

    #[test]
    fn unknown_when_no_signal() {
        let c = classify_conflict("x.yaml", "", &HashMap::new(), None, None);
        assert_eq!(c.kind, "unknown");
    }

    #[test]
    fn find_companion_shared_path_detects_remote_new_path() {
        let all = stages_map(&[
            ("old/case.yaml", 1, "base"),
            ("old/case.yaml", 3, "yours"),
            ("new/case.yaml", 2, "shared"),
        ]);
        assert_eq!(
            find_companion_shared_path("old/case.yaml", &all).as_deref(),
            Some("new/case.yaml")
        );
    }

    #[test]
    fn find_companion_shared_path_none_for_same_path_only() {
        let all = stages_map(&[("case.yaml", 1, "aaa"), ("case.yaml", 3, "bbb")]);
        assert_eq!(find_companion_shared_path("case.yaml", &all), None);
    }

    #[test]
    fn modify_delete_shared_deleted_sets_companion_path() {
        let all = stages_map(&[
            ("old/case.yaml", 1, "base"),
            ("old/case.yaml", 3, "yours"),
            ("new/case.yaml", 2, "shared"),
        ]);
        let c = classify_conflict("old/case.yaml", "my edit", &all, None, Some("my edit"));
        assert_eq!(c.kind, "modify_delete");
        assert!(c.shared_deleted);
        assert_eq!(c.shared_path.as_deref(), Some("new/case.yaml"));
    }

    #[test]
    fn dedupes_rename_primary_paths() {
        let all = stages_map(&[("a.yaml", 2, "same"), ("b.yaml", 3, "same")]);
        let paths = vec!["a.yaml".into(), "b.yaml".into()];
        let primaries = primary_paths_for_conflicts(&paths, &all);
        assert_eq!(primaries.len(), 1);
        assert_eq!(primaries[0], "b.yaml");
    }

    #[test]
    fn lot_of_suite_rename_pairs_by_stage1_hash() {
        let all = stages_map(&[
            ("suite/TLS-0034.yaml", 1, "baseA"),
            ("suite/TLS-0034.yaml", 2, "objShared34"),
            ("suite/TLS-0019.yaml", 1, "baseB"),
            ("suite/TLS-0019.yaml", 3, "objYours19"),
            ("suite/TLS-0040.yaml", 1, "baseC"),
            ("suite/TLS-0040.yaml", 2, "objShared40"),
            ("suite/TLS-0020.yaml", 1, "baseC"),
            ("suite/TLS-0020.yaml", 3, "objYours20"),
        ]);

        let c19 = classify_conflict("suite/TLS-0019.yaml", "", &all, None, Some("y19"));
        assert_ne!(c19.shared_path.as_deref(), Some("suite/TLS-0034.yaml"));
        assert_ne!(c19.kind, "rename");

        let c20 = classify_conflict(
            "suite/TLS-0020.yaml",
            "",
            &all,
            Some("shared40"),
            Some("yours20"),
        );
        assert_eq!(c20.kind, "modify_delete");
        assert!(c20.shared_deleted);
        assert_eq!(c20.shared_path.as_deref(), Some("suite/TLS-0040.yaml"));
        assert!(!c20.has_content_conflict);

        let paths: Vec<String> = all.keys().cloned().collect();
        let primaries = primary_paths_for_conflicts(&paths, &all);
        assert_ne!(
            primaries.len(),
            1,
            "must not collapse unrelated conflicts into one primary"
        );
        assert!(primaries.contains(&"suite/TLS-0020.yaml".to_string()));
    }

    #[test]
    fn multi_move_companion_matches_by_leaf() {
        let all = stages_map(&[
            ("old/TLS-0019.yaml", 1, "b19"),
            ("old/TLS-0019.yaml", 3, "y19"),
            ("new/TLS-0019.yaml", 2, "s19"),
            ("old/TLS-0034.yaml", 1, "b34"),
            ("old/TLS-0034.yaml", 3, "y34"),
            ("new/TLS-0034.yaml", 2, "s34"),
        ]);

        assert_eq!(
            find_companion_shared_path("old/TLS-0034.yaml", &all).as_deref(),
            Some("new/TLS-0034.yaml")
        );
        assert_eq!(
            find_companion_shared_path("old/TLS-0019.yaml", &all).as_deref(),
            Some("new/TLS-0019.yaml")
        );

        let c = classify_conflict("old/TLS-0034.yaml", "edit34", &all, None, Some("edit34"));
        assert_eq!(c.kind, "modify_delete");
        assert_eq!(c.shared_path.as_deref(), Some("new/TLS-0034.yaml"));
    }

    #[test]
    fn stage_paths_for_content_uses_paired_rename_paths() {
        let all = stages_map(&[
            ("suite/TLS-0040.yaml", 1, "baseC"),
            ("suite/TLS-0040.yaml", 2, "objShared40"),
            ("suite/TLS-0020.yaml", 1, "baseC"),
            ("suite/TLS-0020.yaml", 3, "objYours20"),
        ]);
        let (s2, s3) = stage_paths_for_content("suite/TLS-0020.yaml", &all);
        assert_eq!(s2.as_deref(), Some("suite/TLS-0040.yaml"));
        assert_eq!(s3.as_deref(), Some("suite/TLS-0020.yaml"));
    }
}
