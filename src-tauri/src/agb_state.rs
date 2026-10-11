//! Terms of Service (AGB) acceptance state persisted per machine.

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const AGB_VERSION: i32 = 4;
/// Human-readable label for the terms document (independent of app semver).
pub const AGB_DISPLAY_VERSION: &str = "2.0.0";
const AGB_FILE_NAME: &str = "terms_acceptance.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptanceRecord {
    pub version: i32,
    pub accepted_at: String,
    pub machine_id_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgbStatusDto {
    pub accepted: bool,
    pub current_version: i32,
    pub stored_version: Option<i32>,
    pub accepted_at: Option<String>,
    pub display_version: String,
}

fn acceptance_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {e}"))?;
    Ok(dir.join(AGB_FILE_NAME))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    Ok(())
}

fn read_acceptance_record(app: &AppHandle) -> Result<Option<AcceptanceRecord>, String> {
    let path = acceptance_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read AGB acceptance file: {e}"))?;
    match serde_json::from_str::<AcceptanceRecord>(&content) {
        Ok(record) => Ok(Some(record)),
        Err(e) => {
            eprintln!("Ignoring malformed AGB acceptance file: {e}");
            Ok(None)
        }
    }
}

fn write_acceptance_record(app: &AppHandle, record: &AcceptanceRecord) -> Result<(), String> {
    let path = acceptance_file_path(app)?;
    ensure_parent_dir(&path)?;
    let payload = serde_json::to_string_pretty(record)
        .map_err(|e| format!("Failed to serialize AGB acceptance: {e}"))?;
    std::fs::write(&path, payload)
        .map_err(|e| format!("Failed to write AGB acceptance file: {e}"))?;
    Ok(())
}

fn status_from_record(record: Option<AcceptanceRecord>) -> AgbStatusDto {
    let stored_version = record.as_ref().map(|r| r.version);
    let accepted_at = record.as_ref().map(|r| r.accepted_at.clone());
    let accepted = record
        .as_ref()
        .map(|r| r.version >= AGB_VERSION)
        .unwrap_or(false);

    AgbStatusDto {
        accepted,
        current_version: AGB_VERSION,
        stored_version,
        accepted_at,
        display_version: AGB_DISPLAY_VERSION.to_string(),
    }
}

#[tauri::command]
pub fn get_agb_status(app: AppHandle) -> Result<AgbStatusDto, String> {
    let record = read_acceptance_record(&app)?;
    Ok(status_from_record(record))
}

#[tauri::command]
pub fn record_agb_acceptance(app: AppHandle) -> Result<AgbStatusDto, String> {
    let machine_id_hash = crate::license_machine::machine_id_hash();
    let record = AcceptanceRecord {
        version: AGB_VERSION,
        accepted_at: Utc::now().to_rfc3339(),
        machine_id_hash,
    };
    write_acceptance_record(&app, &record)?;
    println!("Recorded AGB acceptance for version {}", AGB_VERSION);
    Ok(status_from_record(Some(record)))
}
