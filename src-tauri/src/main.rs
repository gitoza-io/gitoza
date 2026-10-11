// Prevents extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if gitoza_rust_backend::ssh_silent::is_ssh_silent_invocation() {
        std::process::exit(gitoza_rust_backend::ssh_silent::run());
    }
    gitoza_tauri_lib::run();
}
