use crate::paths::user_home_dir;

/// True when a default private key exists under the user's `~/.ssh` directory.
pub fn has_system_ssh_key() -> bool {
    let ssh_dir = user_home_dir().join(".ssh");
    if !ssh_dir.is_dir() {
        return false;
    }
    for name in ["id_ed25519", "id_rsa"] {
        if ssh_dir.join(name).is_file() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvRestore {
        home: Option<std::ffi::OsString>,
        userprofile: Option<std::ffi::OsString>,
    }

    impl EnvRestore {
        fn lock() -> (MutexGuard<'static, ()>, Self) {
            let guard = ENV_LOCK.lock().unwrap();
            let snapshot = Self {
                home: std::env::var_os("HOME"),
                userprofile: std::env::var_os("USERPROFILE"),
            };
            (guard, snapshot)
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            restore_env_var("HOME", self.home.take());
            restore_env_var("USERPROFILE", self.userprofile.take());
        }
    }

    fn restore_env_var(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
    }

    fn with_temp_home<F: FnOnce(&PathBuf)>(f: F) {
        let (_guard, _restore) = EnvRestore::lock();
        let base = std::env::temp_dir().join(format!("gitoza_ssh_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        unsafe {
            std::env::set_var("HOME", &base);
            std::env::remove_var("USERPROFILE");
        }
        f(&base);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn has_system_ssh_key_false_when_no_ssh_dir() {
        with_temp_home(|home| {
            assert!(!home.join(".ssh").exists());
            assert!(!has_system_ssh_key());
        });
    }

    #[test]
    fn has_system_ssh_key_true_when_ed25519_present() {
        with_temp_home(|home| {
            let ssh_dir = home.join(".ssh");
            fs::create_dir_all(&ssh_dir).unwrap();
            fs::write(ssh_dir.join("id_ed25519"), "fake-key").unwrap();
            assert!(has_system_ssh_key());
        });
    }

    #[test]
    fn has_system_ssh_key_uses_userprofile_when_home_unset() {
        let (_guard, _restore) = EnvRestore::lock();
        let base = std::env::temp_dir().join(format!("gitoza_ssh_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let ssh_dir = base.join(".ssh");
        fs::create_dir_all(&ssh_dir).unwrap();
        fs::write(ssh_dir.join("id_rsa"), "fake-key").unwrap();
        unsafe {
            std::env::remove_var("HOME");
            std::env::set_var("USERPROFILE", &base);
        }
        assert!(has_system_ssh_key());
        let _ = fs::remove_dir_all(&base);
    }
}
