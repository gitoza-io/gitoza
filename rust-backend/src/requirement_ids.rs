//! Case ↔ ticket links: YAML `requirement_ids` list with legacy `requirement_id` reads.
//! SQLite keeps the column name `requirement_id` and stores a JSON array (or a legacy scalar).

use std::collections::{BTreeMap, HashSet};

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use serde_yaml::Value as YamlValue;

/// Dedupe case-insensitively; keep first-seen order and original spelling.
pub(crate) fn normalize_requirement_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for raw in ids {
        let id = raw.trim().to_string();
        if id.is_empty() {
            continue;
        }
        let key = id.to_lowercase();
        if seen.insert(key) {
            out.push(id);
        }
    }
    out
}

fn ids_from_yaml_value(v: &YamlValue) -> Vec<String> {
    match v {
        YamlValue::String(s) => s
            .split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect(),
        YamlValue::Sequence(seq) => seq
            .iter()
            .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        _ => vec![],
    }
}

/// Read canonical `requirement_ids` plus legacy `requirement_id` (string or sequence).
pub(crate) fn parse_requirement_ids_from_yaml_map(
    lower: &BTreeMap<String, YamlValue>,
) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(v) = lower.get("requirement_ids") {
        ids.extend(ids_from_yaml_value(v));
    }
    if let Some(v) = lower.get("requirement_id") {
        ids.extend(ids_from_yaml_value(v));
    }
    normalize_requirement_ids(ids)
}

/// Write `requirement_ids` sequence; drop empty and leftover `requirement_id`.
pub(crate) fn insert_requirement_ids_into_fm(
    fm: &mut IndexMap<String, YamlValue>,
    ids: &[String],
) {
    fm.shift_remove("requirement_id");
    let ids = normalize_requirement_ids(ids.to_vec());
    if ids.is_empty() {
        fm.shift_remove("requirement_ids");
        return;
    }
    fm.insert(
        "requirement_ids".to_string(),
        YamlValue::Sequence(ids.into_iter().map(YamlValue::String).collect()),
    );
}

pub(crate) fn requirement_ids_json_for_db(ids: &[String]) -> Option<String> {
    let ids = normalize_requirement_ids(ids.to_vec());
    if ids.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string()))
    }
}

fn ids_from_json_value(v: &JsonValue) -> Vec<String> {
    match v {
        JsonValue::String(s) => s
            .split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect(),
        JsonValue::Array(arr) => arr
            .iter()
            .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        _ => vec![],
    }
}

/// Parse SQLite `requirement_id` TEXT: JSON array, JSON string, or legacy scalar.
pub(crate) fn requirement_ids_from_db(raw: Option<&str>) -> Vec<String> {
    let s = match raw.map(str::trim).filter(|t| !t.is_empty()) {
        Some(v) => v,
        None => return vec![],
    };
    if let Ok(v) = serde_json::from_str::<JsonValue>(s) {
        return normalize_requirement_ids(ids_from_json_value(&v));
    }
    normalize_requirement_ids(vec![s.to_string()])
}

pub(crate) fn parse_requirement_ids_from_json_map(
    co: &serde_json::Map<String, JsonValue>,
) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(v) = co.get("requirement_ids") {
        ids.extend(ids_from_json_value(v));
    }
    if let Some(v) = co.get("requirement_id") {
        ids.extend(ids_from_json_value(v));
    }
    normalize_requirement_ids(ids)
}

pub(crate) fn requirement_ids_to_json_value(ids: &[String]) -> Option<JsonValue> {
    let ids = normalize_requirement_ids(ids.to_vec());
    if ids.is_empty() {
        None
    } else {
        Some(JsonValue::Array(
            ids.into_iter().map(JsonValue::String).collect(),
        ))
    }
}

#[cfg(test)]
pub(crate) fn join_requirement_ids(ids: &[String]) -> String {
    normalize_requirement_ids(ids.to_vec()).join(", ")
}

pub(crate) fn add_requirement_id(ids: Vec<String>, ticket_id: &str) -> Vec<String> {
    let mut next = ids;
    next.push(ticket_id.to_string());
    normalize_requirement_ids(next)
}

pub(crate) fn remove_requirement_id(ids: Vec<String>, ticket_id: &str) -> Vec<String> {
    let needle = ticket_id.trim().to_lowercase();
    if needle.is_empty() {
        return normalize_requirement_ids(ids);
    }
    normalize_requirement_ids(
        ids.into_iter()
            .filter(|id| id.trim().to_lowercase() != needle)
            .collect(),
    )
}

/// SQL fragment: column is a legacy scalar equal to `?` or a JSON array containing `?`.
/// Bind the ticket id twice.
pub(crate) fn sql_requirement_id_contains(column: &str) -> String {
    format!(
        "(LOWER(TRIM({column})) = LOWER(?) OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid({column}) THEN {column} ELSE '[]' END) WHERE LOWER(TRIM(value)) = LOWER(?)))"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml_map(pairs: &[(&str, YamlValue)]) -> BTreeMap<String, YamlValue> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    fn yaml_index_map(pairs: &[(&str, YamlValue)]) -> IndexMap<String, YamlValue> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn parse_legacy_scalar() {
        let lower = yaml_map(&[("requirement_id", YamlValue::String("DEMO-1".into()))]);
        assert_eq!(
            parse_requirement_ids_from_yaml_map(&lower),
            vec!["DEMO-1".to_string()]
        );
    }

    #[test]
    fn parse_legacy_sequence_and_canonical_list() {
        let lower = yaml_map(&[(
            "requirement_id",
            YamlValue::Sequence(vec![
                YamlValue::String("A".into()),
                YamlValue::String("B".into()),
            ]),
        )]);
        assert_eq!(
            parse_requirement_ids_from_yaml_map(&lower),
            vec!["A".to_string(), "B".to_string()]
        );

        let lower = yaml_map(&[(
            "requirement_ids",
            YamlValue::Sequence(vec![
                YamlValue::String("A".into()),
                YamlValue::String("B".into()),
            ]),
        )]);
        assert_eq!(
            parse_requirement_ids_from_yaml_map(&lower),
            vec!["A".to_string(), "B".to_string()]
        );
    }

    #[test]
    fn parse_mixed_keys_dedupes_case_insensitive() {
        let lower = yaml_map(&[
            (
                "requirement_ids",
                YamlValue::Sequence(vec![YamlValue::String("DEMO-1".into())]),
            ),
            ("requirement_id", YamlValue::String("demo-1".into())),
        ]);
        assert_eq!(
            parse_requirement_ids_from_yaml_map(&lower),
            vec!["DEMO-1".to_string()]
        );
    }

    #[test]
    fn write_omits_empty_and_strips_legacy_key() {
        let mut fm = yaml_index_map(&[("requirement_id", YamlValue::String("OLD".into()))]);
        insert_requirement_ids_into_fm(&mut fm, &[]);
        assert!(!fm.contains_key("requirement_id"));
        assert!(!fm.contains_key("requirement_ids"));

        insert_requirement_ids_into_fm(&mut fm, &["A".into(), "A".into(), "B".into()]);
        assert!(!fm.contains_key("requirement_id"));
        let seq = fm.get("requirement_ids").and_then(|v| v.as_sequence());
        assert_eq!(seq.map(|s| s.len()), Some(2));
    }

    #[test]
    fn db_json_and_legacy_scalar() {
        assert_eq!(requirement_ids_from_db(None), Vec::<String>::new());
        assert_eq!(
            requirement_ids_from_db(Some("DEMO-1")),
            vec!["DEMO-1".to_string()]
        );
        assert_eq!(
            requirement_ids_from_db(Some(r#"["A","B"]"#)),
            vec!["A".to_string(), "B".to_string()]
        );
        assert_eq!(
            requirement_ids_json_for_db(&["A".into(), "B".into()]).as_deref(),
            Some(r#"["A","B"]"#)
        );
        assert!(requirement_ids_json_for_db(&[]).is_none());
    }

    #[test]
    fn add_and_remove_ids() {
        let linked = add_requirement_id(vec!["A".into()], "B");
        assert_eq!(linked, vec!["A".to_string(), "B".to_string()]);
        assert_eq!(add_requirement_id(linked.clone(), "a"), linked);
        assert_eq!(remove_requirement_id(linked, "A"), vec!["B".to_string()]);
    }

    #[test]
    fn json_map_accepts_legacy_string() {
        let mut co = serde_json::Map::new();
        co.insert(
            "requirement_id".to_string(),
            JsonValue::String("REQ-42".into()),
        );
        assert_eq!(
            parse_requirement_ids_from_json_map(&co),
            vec!["REQ-42".to_string()]
        );
    }
}
