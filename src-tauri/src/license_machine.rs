//! Stable machine fingerprint (SHA-256 hex) for license binding in the desktop app.

use sha2::{Digest, Sha256};

/// Returns a hex-encoded SHA-256 of the OS machine id (see `machine-uid` crate).
pub fn machine_id_hash() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| {
        hostname::get()
            .map(|h| h.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "unknown-host".to_string())
    });
    let digest = Sha256::digest(raw.as_bytes());
    hex::encode(digest)
}
