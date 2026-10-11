//! Machine-wide S3 credentials (OS keychain) and blueprint JSON under `~/.gitoza/sync_secrets/`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::AppState;

pub const KEYRING_SERVICE: &str = "com.gitoza";
pub const KEYRING_USER: &str = "global_s3";

pub const SYNC_SECRETS_DIR: &str = "sync_secrets";
pub const GLOBAL_S3_BLUEPRINT_FILE: &str = "global_s3_blueprint.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncSecrets {
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

/// Machine-wide S3 credentials (no session token).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GlobalS3Profile {
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl From<GlobalS3Profile> for SyncSecrets {
    fn from(p: GlobalS3Profile) -> Self {
        Self {
            access_key_id: p.access_key_id,
            secret_access_key: p.secret_access_key,
            session_token: None,
        }
    }
}

/// Machine-wide default S3 infrastructure metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GlobalS3Blueprint {
    pub s3_bucket: String,
    pub s3_region: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_endpoint: Option<String>,
}

pub fn secrets_dir(state: &AppState) -> PathBuf {
    state.config_dir.join(SYNC_SECRETS_DIR)
}

pub fn global_s3_blueprint_path(state: &AppState) -> PathBuf {
    secrets_dir(state).join(GLOBAL_S3_BLUEPRINT_FILE)
}

fn keyring_entry() -> Result<&'static Entry, String> {
    static ENTRY: OnceLock<Result<Entry, String>> = OnceLock::new();
    ENTRY
        .get_or_init(|| {
            Entry::new(KEYRING_SERVICE, KEYRING_USER)
                .map_err(|e| format!("Failed to open system keychain entry: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

fn map_keyring_load_error(err: keyring::Error) -> String {
    match err {
        keyring::Error::NoEntry => "S3 credentials are not saved on this device".to_string(),
        keyring::Error::PlatformFailure(inner) => format!(
            "System keychain is unavailable ({inner}). On Linux, ensure a Secret Service is running (GNOME Keyring or KWallet) and unlocked."
        ),
        other => format!("Failed to read S3 credentials from system keychain: {other}"),
    }
}

fn map_keyring_save_error(err: keyring::Error) -> String {
    match err {
        keyring::Error::PlatformFailure(inner) => format!(
            "Could not store credentials in the system keychain ({inner}). On Linux, ensure a Secret Service is running (GNOME Keyring or KWallet) and unlocked."
        ),
        other => format!("Failed to store S3 credentials in system keychain: {other}"),
    }
}

fn validate_profile(p: &GlobalS3Profile) -> Result<(), String> {
    if p.access_key_id.trim().is_empty() || p.secret_access_key.trim().is_empty() {
        return Err("S3 credentials must not be empty".to_string());
    }
    Ok(())
}

fn load_profile_from_keychain() -> Result<GlobalS3Profile, String> {
    let entry = keyring_entry()?;
    let raw = entry.get_password().map_err(map_keyring_load_error)?;
    let p: GlobalS3Profile = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid S3 credentials in system keychain: {e}"))?;
    validate_profile(&p)?;
    Ok(p)
}

fn save_profile_to_keychain(profile: &GlobalS3Profile) -> Result<(), String> {
    validate_profile(profile)?;
    let out = serde_json::to_string(profile)
        .map_err(|e| format!("Failed to serialize S3 credentials: {e}"))?;
    let entry = keyring_entry()?;
    entry.set_password(&out).map_err(map_keyring_save_error)
}

fn keyring_has_credentials() -> bool {
    match keyring_entry() {
        Ok(entry) => match entry.get_password() {
            Ok(raw) => serde_json::from_str::<GlobalS3Profile>(&raw)
                .ok()
                .and_then(|p| validate_profile(&p).ok())
                .is_some(),
            Err(keyring::Error::NoEntry) => false,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

pub fn sync_secrets_configured(_state: &AppState) -> bool {
    keyring_has_credentials()
}

/// `credentials_storage` hint for API responses when credentials exist.
pub fn credentials_storage_kind(state: &AppState) -> Option<&'static str> {
    if sync_secrets_configured(state) {
        Some("keychain")
    } else {
        None
    }
}

/// True when keychain has credentials and the blueprint file exists.
pub fn global_s3_onboarding_available(state: &AppState) -> bool {
    sync_secrets_configured(state) && global_s3_blueprint_path(state).is_file()
}

/// Read-only probe: checks global profile + blueprint and returns blueprint for UI labeling.
pub async fn probe_global_s3_onboarding(
    state: &AppState,
) -> Result<(bool, Option<GlobalS3Blueprint>), String> {
    if !global_s3_onboarding_available(state) {
        return Ok((false, None));
    }
    match load_global_s3_blueprint(state).await {
        Ok(blueprint) => Ok((true, Some(blueprint))),
        Err(e) => Err(e),
    }
}

pub fn load_global_sync_secrets(_state: &AppState) -> Result<SyncSecrets, String> {
    Ok(load_profile_from_keychain()?.into())
}

pub async fn load_global_s3_profile(_state: &AppState) -> Result<GlobalS3Profile, String> {
    load_profile_from_keychain()
}

pub async fn load_global_s3_blueprint(state: &AppState) -> Result<GlobalS3Blueprint, String> {
    let path = global_s3_blueprint_path(state);
    if !path.is_file() {
        return Err(format!("Missing global S3 blueprint: {}", path.display()));
    }
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read global S3 blueprint: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid global S3 blueprint JSON: {e}"))
}

async fn write_json_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid secrets path".to_string())?;
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| format!("Failed to create secrets dir: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, contents)
        .await
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    set_private_file_permissions(&tmp);
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| format!("Failed to rename {}: {e}", path.display()))?;
    set_private_file_permissions(path);
    Ok(())
}

pub async fn save_global_s3_profile(
    _state: &AppState,
    profile: &GlobalS3Profile,
) -> Result<(), String> {
    save_profile_to_keychain(profile)
}

pub async fn save_global_s3_blueprint(
    state: &AppState,
    blueprint: &GlobalS3Blueprint,
) -> Result<(), String> {
    let out = serde_json::to_string_pretty(blueprint)
        .map_err(|e| format!("Failed to serialize global S3 blueprint: {e}"))?;
    write_json_atomic(&global_s3_blueprint_path(state), &out).await
}

pub async fn save_global_s3_cache(
    state: &AppState,
    profile: &GlobalS3Profile,
    blueprint: &GlobalS3Blueprint,
) -> Result<(), String> {
    save_global_s3_profile(state, profile).await?;
    save_global_s3_blueprint(state, blueprint).await
}

fn set_private_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Once;

    static INIT_MOCK_KEYRING: Once = Once::new();

    fn init_mock_keyring() {
        INIT_MOCK_KEYRING.call_once(|| {
            let _ = keyring::set_default_credential_builder(
                keyring::mock::default_credential_builder(),
            );
        });
    }

    fn temp_state() -> (AppState, PathBuf) {
        init_mock_keyring();
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "gitoza_sync_secrets_test_{}_{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (crate::new_state(dir.clone()), dir)
    }

    fn sample_profile() -> GlobalS3Profile {
        GlobalS3Profile {
            access_key_id: "AKIA".to_string(),
            secret_access_key: "secret".to_string(),
        }
    }

    #[test]
    fn global_blueprint_omits_empty_optional_fields() {
        let bp = GlobalS3Blueprint {
            s3_bucket: "b".to_string(),
            s3_region: "auto".to_string(),
            s3_prefix: None,
            s3_endpoint: None,
        };
        let json = serde_json::to_string(&bp).unwrap();
        assert!(!json.contains("s3_prefix"));
        assert!(!json.contains("s3_endpoint"));
    }

    #[tokio::test]
    async fn save_and_load_via_keychain() {
        init_mock_keyring();
        let (state, _dir) = temp_state();
        let profile = sample_profile();
        save_global_s3_profile(&state, &profile).await.unwrap();
        assert!(sync_secrets_configured(&state));
        let loaded = load_global_s3_profile(&state).await.unwrap();
        assert_eq!(loaded, profile);
        let secrets = load_global_sync_secrets(&state).unwrap();
        assert_eq!(secrets.access_key_id, "AKIA");
    }

    #[tokio::test]
    async fn sync_secrets_configured_when_keychain_populated() {
        init_mock_keyring();
        let (state, _dir) = temp_state();
        assert!(!sync_secrets_configured(&state));
        save_global_s3_profile(&state, &sample_profile())
            .await
            .unwrap();
        assert!(sync_secrets_configured(&state));
        assert_eq!(credentials_storage_kind(&state), Some("keychain"));
    }

    #[tokio::test]
    async fn save_and_load_global_cache_round_trip() {
        init_mock_keyring();
        let (state, dir) = temp_state();
        let profile = sample_profile();
        let blueprint = GlobalS3Blueprint {
            s3_bucket: "my-bucket".to_string(),
            s3_region: "eu-central-1".to_string(),
            s3_prefix: Some("assets/".to_string()),
            s3_endpoint: Some("https://example.r2.cloudflarestorage.com".to_string()),
        };
        save_global_s3_cache(&state, &profile, &blueprint)
            .await
            .unwrap();
        let loaded_p = load_global_s3_profile(&state).await.unwrap();
        let loaded_b = load_global_s3_blueprint(&state).await.unwrap();
        assert_eq!(loaded_p, profile);
        assert_eq!(loaded_b, blueprint);
        assert!(global_s3_onboarding_available(&state));
        let _ = fs::remove_dir_all(&dir);
    }
}
