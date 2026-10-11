use serde::Serialize;

use crate::models::ConflictFileContent;

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_file_contents: Option<Vec<ConflictFileContent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_files: Option<Vec<String>>,
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            code: "bad_request".into(),
            message: msg.into(),
            conflict_file_contents: None,
            conflict_files: None,
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            code: "not_found".into(),
            message: msg.into(),
            conflict_file_contents: None,
            conflict_files: None,
        }
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self {
            code: "conflict".into(),
            message: msg.into(),
            conflict_file_contents: None,
            conflict_files: None,
        }
    }

    pub fn conflict_with_files(
        msg: impl Into<String>,
        contents: Vec<ConflictFileContent>,
        files: Option<Vec<String>>,
    ) -> Self {
        Self {
            code: "conflict".into(),
            message: msg.into(),
            conflict_file_contents: Some(contents),
            conflict_files: files,
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: "internal_error".into(),
            message: msg.into(),
            conflict_file_contents: None,
            conflict_files: None,
        }
    }

    pub fn unprocessable(msg: impl Into<String>) -> Self {
        Self {
            code: "unprocessable".into(),
            message: msg.into(),
            conflict_file_contents: None,
            conflict_files: None,
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}
