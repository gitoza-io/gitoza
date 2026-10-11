//! Windows SSH shim: same binary invoked as `gitoza-ssh-silent.exe` so Git can use
//! `GIT_SSH` without a shell, and the real `ssh` runs with a hidden console.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::path::Path;

/// Executable stem used for the BusyBox-style hardlink beside the main app binary.
pub const SSH_SILENT_STEM: &str = "gitoza-ssh-silent";

/// Shared SSH flags for non-interactive network Git (BatchMode + connect/keepalive).
pub const NETWORK_SSH_OPTIONS: &[&str] = &[
    "BatchMode=yes",
    "ConnectTimeout=15",
    "ServerAliveInterval=10",
    "ServerAliveCountMax=3",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// True when this process was started as `gitoza-ssh-silent` (stem of `current_exe`).
pub fn is_ssh_silent_invocation() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.file_stem()
                .map(|s| s.to_string_lossy().eq_ignore_ascii_case(SSH_SILENT_STEM))
        })
        .unwrap_or(false)
}

/// Forward argv to real `ssh` with BatchMode / connect / keepalive and a hidden console on Windows.
///
/// Stdio is inherited so Git's SSH pack protocol keeps working. Returns the process exit code
/// (or 1 on spawn failure).
pub fn run() -> i32 {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let ssh = resolve_ssh_program();
    let mut cmd = Command::new(&ssh);
    for opt in NETWORK_SSH_OPTIONS {
        cmd.arg("-o").arg(opt);
    }
    cmd.args(&args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("gitoza-ssh-silent: failed to run {}: {e}", ssh.display());
            1
        }
    }
}

fn resolve_ssh_program() -> PathBuf {
    #[cfg(windows)]
    {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let openssh = system_root.join(r"System32\OpenSSH\ssh.exe");
        if openssh.is_file() {
            return openssh;
        }
    }
    PathBuf::from("ssh")
}

/// Ensure `gitoza-ssh-silent.exe` exists beside the current executable (hardlink, else copy).
/// Recreates when the main binary looks newer/larger than the shim.
#[cfg(windows)]
pub fn ensure_ssh_silent_shim() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let shim = exe.with_file_name(format!("{SSH_SILENT_STEM}.exe"));
    if shim_needs_refresh(&exe, &shim) {
        let _ = std::fs::remove_file(&shim);
        if std::fs::hard_link(&exe, &shim).is_err() {
            std::fs::copy(&exe, &shim).ok()?;
        }
    }
    shim.is_file().then_some(shim)
}

#[cfg(not(windows))]
pub fn ensure_ssh_silent_shim() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn shim_needs_refresh(exe: &Path, shim: &Path) -> bool {
    if !shim.is_file() {
        return true;
    }
    let Ok(exe_meta) = std::fs::metadata(exe) else {
        return true;
    };
    let Ok(shim_meta) = std::fs::metadata(shim) else {
        return true;
    };
    if exe_meta.len() != shim_meta.len() {
        return true;
    }
    match (exe_meta.modified(), shim_meta.modified()) {
        (Ok(e), Ok(s)) => e > s,
        _ => false,
    }
}
