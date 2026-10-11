//! Workflow step and publish outcome types (no Serde IPC models).

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowStep {
    Staged,
    Committed,
    RebaseDone,
}

impl WorkflowStep {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Staged => "staged",
            Self::Committed => "committed",
            Self::RebaseDone => "rebase_done",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "staged" => Some(Self::Staged),
            "committed" => Some(Self::Committed),
            "rebase_done" => Some(Self::RebaseDone),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConflictFile {
    pub file_path: String,
    pub content: String,
    pub conflict_kind: String,
    pub shared_deleted: bool,
    pub your_content: Option<String>,
    pub shared_content: Option<String>,
    pub your_path: Option<String>,
    pub shared_path: Option<String>,
    pub base_path: Option<String>,
    pub has_content_conflict: bool,
    pub related_paths: Vec<String>,
}

/// One resolved conflict file from the host UI.
#[derive(Debug, Clone)]
pub struct ConflictResolution {
    pub file_path: String,
    pub content: Option<String>,
    pub conflict_kind: String,
    pub action: Option<String>,
    pub shared_deleted: bool,
    pub new_path: Option<String>,
    pub chosen_path: Option<String>,
    pub related_paths: Vec<String>,
}

#[derive(Debug)]
pub enum PublishOutcome {
    Published {
        pre_rebase_sha: String,
    },
    NothingToCommit,
    Conflict {
        files: Vec<String>,
        contents: Vec<ConflictFile>,
        message: String,
    },
    PushFailed {
        message: String,
        reason: String,
        pre_rebase_sha: String,
    },
    /// Soft failure (e.g. rebase --continue failed without conflicts).
    Failed {
        message: String,
    },
}

#[derive(Debug)]
pub enum PublishError {
    BadRequest(String),
    Internal(String),
}

impl fmt::Display for PublishError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadRequest(m) | Self::Internal(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for PublishError {}

impl From<anyhow::Error> for PublishError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(format!("{e:#}"))
    }
}
