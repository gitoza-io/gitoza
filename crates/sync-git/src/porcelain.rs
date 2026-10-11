//! Parse `git status --porcelain -z` output into unique repo-relative paths.

use std::collections::HashSet;

/// Parse NUL-terminated porcelain v1 output from `git status -z`.
///
/// Git short format is two status characters (index + work tree) followed by one or more spaces
/// and the path. Requiring a space at byte index 2 is wrong for lines like `D .gitoza/...`
/// where the path begins at index 2 (`D`, work-tree column, then path).
pub fn parse_status_porcelain_z(out: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let parts: Vec<&str> = out.split('\0').filter(|s| !s.is_empty()).collect();
    let mut i = 0usize;
    while i < parts.len() {
        let t = parts[i];
        if t.starts_with("??") {
            let path = if t.starts_with("?? ") {
                t[3..].trim()
            } else {
                t[2..].trim_start()
            };
            push_path_unique(&mut paths, &mut seen, path);
            i += 1;
            continue;
        }
        if t.starts_with("## ") {
            i += 1;
            continue;
        }
        if t.len() < 2 {
            i += 1;
            continue;
        }
        let b = t.as_bytes();
        let rest = t[2..].trim_start();
        if rest.is_empty() {
            i += 1;
            continue;
        }
        push_path_unique(&mut paths, &mut seen, rest);
        let rename_or_copy = b[0] == b'R' || b[0] == b'C' || b[1] == b'R' || b[1] == b'C';
        if rename_or_copy && i + 1 < parts.len() {
            let next = parts[i + 1];
            let nb = next.as_bytes();
            let next_is_header = next.starts_with("??")
                || next.starts_with("## ")
                || (next.len() >= 3 && nb[2] == b' ');
            if !next_is_header {
                push_path_unique(&mut paths, &mut seen, next.trim());
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    paths
}

fn push_path_unique(paths: &mut Vec<String>, seen: &mut HashSet<String>, p: &str) {
    let p = p.replace('\\', "/");
    if p.is_empty() {
        return;
    }
    if seen.insert(p.clone()) {
        paths.push(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_porcelain_z_includes_deleted_and_untracked() {
        // Staged delete (two spaces after D) + untracked file (same format as git status -z).
        let s = "D  .gitoza/test/cases/deleted.yaml\0?? .gitoza/test/cases/new.yaml\0";
        let p = parse_status_porcelain_z(s);
        assert!(
            p.iter().any(|x| x.ends_with("deleted.yaml")),
            "expected deleted path, got {p:?}"
        );
        assert!(
            p.iter().any(|x| x.ends_with("new.yaml")),
            "expected untracked path, got {p:?}"
        );
        // Work-tree delete: ` D` + path starting at index 2 (path must not be dropped).
        let s2 = " D .gitoza/test/cases/wt-del.yaml\0";
        let p2 = parse_status_porcelain_z(s2);
        assert!(
            p2.iter().any(|x| x.ends_with("wt-del.yaml")),
            "expected wt delete path, got {p2:?}"
        );
        // Rename: new path + old path (second record has no XY prefix).
        let s3 = "R  .gitoza/test/cases/n.yaml\0.gitoza/test/cases/o.yaml\0";
        let p3 = parse_status_porcelain_z(s3);
        assert_eq!(p3.len(), 2, "{p3:?}");
    }
}
