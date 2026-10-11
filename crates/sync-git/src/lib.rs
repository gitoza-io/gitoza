//! Low-level Git CLI helpers: spawn `git`, SSH shim, run wrappers, porcelain parsing.
//!
//! No product workflow (confirm/rebase state) lives here — that stays in `gitoza-rust-backend`.

pub mod porcelain;
pub mod process;
pub mod run;
pub mod ssh_silent;

pub use porcelain::parse_status_porcelain_z;
pub use process::{
    git_command, git_command_blocking, git_run_global, git_show_semaphore, git_stdout_global,
    network_git_env, GitGlobalRunResult,
};
pub use run::{
    git_output_to_result, git_run, git_run_env, git_run_env_timeout, git_run_network,
    git_run_network_timeout, git_stdout, git_stdout_blocking, GitRunResult,
};
