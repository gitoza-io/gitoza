//! Tauri shell for Gitoza: desktop window, updater, and IPC backend.

mod agb_state;
mod commands;
mod license_machine;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Backend AppState (replaces the standalone Axum server).
            let config_dir = gitoza_rust_backend::default_config_dir();
            let backend_state = gitoza_rust_backend::new_state(config_dir);

            // Desktop app is always "active" — auto-fetch loop should run.
            backend_state.active_ws_clients.store(1, Ordering::SeqCst);

            let state_arc = Arc::new(backend_state);

            // Bridge: forward ws_tx broadcast messages to Tauri events.
            {
                let mut rx = state_arc.ws_tx.subscribe();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    while let Ok(msg) = rx.recv().await {
                        let _ = handle.emit("backend-refresh", msg);
                    }
                });
            }

            // Background: initial async indexing (same as serve_http).
            {
                let s = state_arc.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = gitoza_rust_backend::ipc_api::_start_initial_indexing(&s).await;
                });
            }

            // Background: auto-fetch loop (same as serve_http).
            {
                let s = state_arc.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    auto_fetch_loop(&s, &handle).await;
                });
            }

            app.manage(state_arc);
            Ok(())
        })
        .invoke_handler({
            #[cfg(debug_assertions)]
            {
                tauri::generate_handler![
                    // Terms of Service commands
                    agb_state::get_agb_status,
                    agb_state::record_agb_acceptance,
                    // Backend API commands
                    commands::get_repo_connection,
                    commands::list_repos,
                    commands::delete_repo,
                    commands::quick_sync_repo,
                    commands::index_from_git_status,
                    commands::get_ssh_status,
                    commands::connect_repo,
                    commands::create_playground,
                    commands::playground_save_changes,
                    commands::create_project,
                    commands::delete_project,
                    commands::create_folder,
                    commands::rename_folder,
                    commands::delete_folder,
                    commands::create_case,
                    commands::batch_create_cases,
                    commands::rename_case,
                    commands::move_case,
                    commands::delete_case,
                    commands::approve_case,
                    commands::archive_case,
                    commands::archive_cases,
                    commands::restore_case,
                    commands::restore_cases,
                    commands::restore_folder,
                    commands::archive_folder,
                    commands::reindex_cases,
                    commands::get_repo_status,
                    commands::get_project_test_config,
                    commands::set_project_test_config,
                    commands::set_project_feature_flags,
                    commands::get_project_sync_config,
                    commands::set_project_sync_config,
                    commands::verify_and_resolve_s3_state,
                    commands::link_repo_to_global_s3_profile,
                    commands::probe_global_s3_onboarding,
                    commands::get_dashboard_summary,
                    commands::get_repository_tree,
                    commands::list_cases,

                    commands::list_tickets,
                    commands::get_ticket_filters,
                    commands::get_ticket_detail,
                    commands::list_ticket_projects,
                    commands::create_ticket_project,
                    commands::get_ticket_project,
                    commands::update_ticket_project,
                    commands::get_ticket_project_breakdown,
                    commands::get_release_ticket_breakdown,
                    commands::set_ticket_project_archived,
                    commands::delete_ticket_project,
                    commands::create_ticket,
                    commands::update_ticket,
                    commands::rename_ticket,
                    commands::post_ticket_comment,
                    commands::delete_ticket_comment,
                    commands::reindex_tickets,
                    commands::list_releases,
                    commands::get_release_filters,
                    commands::get_release_detail,
                    commands::create_release,
                    commands::update_release,
                    commands::reindex_releases,
                    commands::list_wiki_pages,
                    commands::get_wiki_filters,
                    commands::get_wiki_page_detail,
                    commands::get_wiki_tree,
                    commands::create_wiki_folder,
                    commands::create_wiki_page,
                    commands::update_wiki_page,
                    commands::reindex_wiki,
                    commands::move_wiki_page,
                    commands::move_wiki_pages,
                    commands::archive_wiki_page,
                    commands::archive_wiki_pages,
                    commands::archive_wiki_folder,
                    commands::restore_wiki_page,
                    commands::restore_wiki_pages,
                    commands::restore_wiki_folder,
                    commands::delete_wiki_page,
                    commands::delete_wiki_folder,
                    commands::delete_active_wiki_folder,
                    commands::get_case_filters,
                    commands::search_run_cases,
                    commands::get_run_case_filters,
                    commands::get_case_detail,
                    commands::update_case,
                    commands::link_case_requirement,
                    commands::unlink_case_requirement,
                    commands::post_case_comment,
                    commands::delete_case_comment,
                    commands::get_git_user_name,
                    commands::get_git_profile,
                    commands::set_git_profile,
                    commands::sync_git_user_cache,
                    commands::list_case_templates,
                    commands::get_case_template_content,
                    commands::save_case_template,
                    commands::capture_pending_changes,
                    commands::clear_pending_changes,
                    commands::discard_pending_paths,
                    commands::get_pending_diff_files,
                    commands::get_pending_diff_content,
                    commands::workflow_ensure_draft,
                    commands::workflow_push_failed_status,
                    commands::confirm_changes,
                    commands::resolve_rebase,
                    commands::abort_rebase,
                    commands::recover_confirm_workflow,
                    commands::prefetch_repo,
                    commands::create_run,
                    commands::list_runs,
                    commands::get_run,
                    commands::list_run_cases,
                    commands::list_run_case_paths,
                    commands::get_run_folder_tree,
                    commands::get_run_case_comments,
                    commands::get_run_breakdown,
                    commands::get_project_case_breakdown,
                    commands::get_run_case_content,
                    commands::patch_run,
                    commands::link_run_requirement,
                    commands::unlink_run_requirement,
                    commands::patch_run_case,
                    commands::get_workspace_usernames,
                    commands::approve_run,
                    commands::duplicate_run,
                    commands::add_run_cases,
                    commands::remove_run_cases,
                    commands::post_run_comment,
                    commands::post_run_case_comment,
                    commands::delete_run_comment,
                    commands::delete_run_case_comment,
                    commands::set_run_result,
                    commands::set_run_results_batch,
                    commands::flush_pending_run_yaml,
                    commands::delete_run,
                    commands::restore_run,
                    commands::ensure_baseline_sync,
                    commands::export_cases_pdf,
                    commands::export_runs_pdf,
                    commands::save_test_asset,
                    commands::sync_pending_assets,
                    commands::resolve_and_load_asset,
                    commands::delete_local_asset,
                    commands::sync_automation_executions,
                    commands::list_automation_pipelines,
                    commands::list_automation_executions,
                    commands::get_automation_execution,
                    commands::list_automation_results,
                    commands::list_automation_suites,
                    commands::get_automation_result_detail,
                ]
            }
            #[cfg(not(debug_assertions))]
            {
                tauri::generate_handler![
                    // Terms of Service commands
                    agb_state::get_agb_status,
                    agb_state::record_agb_acceptance,
                    // Backend API commands
                    commands::get_repo_connection,
                    commands::list_repos,
                    commands::delete_repo,
                    commands::quick_sync_repo,
                    commands::index_from_git_status,
                    commands::get_ssh_status,
                    commands::connect_repo,
                    commands::create_playground,
                    commands::playground_save_changes,
                    commands::create_project,
                    commands::delete_project,
                    commands::create_folder,
                    commands::rename_folder,
                    commands::delete_folder,
                    commands::create_case,
                    commands::batch_create_cases,
                    commands::rename_case,
                    commands::move_case,
                    commands::delete_case,
                    commands::approve_case,
                    commands::archive_case,
                    commands::archive_cases,
                    commands::restore_case,
                    commands::restore_cases,
                    commands::restore_folder,
                    commands::archive_folder,
                    commands::reindex_cases,
                    commands::get_repo_status,
                    commands::get_project_test_config,
                    commands::set_project_test_config,
                    commands::set_project_feature_flags,
                    commands::get_project_sync_config,
                    commands::set_project_sync_config,
                    commands::verify_and_resolve_s3_state,
                    commands::link_repo_to_global_s3_profile,
                    commands::probe_global_s3_onboarding,
                    commands::get_dashboard_summary,
                    commands::get_repository_tree,
                    commands::list_cases,

                    commands::list_tickets,
                    commands::get_ticket_filters,
                    commands::get_ticket_detail,
                    commands::list_ticket_projects,
                    commands::create_ticket_project,
                    commands::get_ticket_project,
                    commands::update_ticket_project,
                    commands::get_ticket_project_breakdown,
                    commands::get_release_ticket_breakdown,
                    commands::set_ticket_project_archived,
                    commands::delete_ticket_project,
                    commands::create_ticket,
                    commands::update_ticket,
                    commands::rename_ticket,
                    commands::post_ticket_comment,
                    commands::delete_ticket_comment,
                    commands::reindex_tickets,
                    commands::list_releases,
                    commands::get_release_filters,
                    commands::get_release_detail,
                    commands::create_release,
                    commands::update_release,
                    commands::reindex_releases,
                    commands::list_wiki_pages,
                    commands::get_wiki_filters,
                    commands::get_wiki_page_detail,
                    commands::get_wiki_tree,
                    commands::create_wiki_folder,
                    commands::create_wiki_page,
                    commands::update_wiki_page,
                    commands::reindex_wiki,
                    commands::move_wiki_page,
                    commands::move_wiki_pages,
                    commands::archive_wiki_page,
                    commands::archive_wiki_pages,
                    commands::archive_wiki_folder,
                    commands::restore_wiki_page,
                    commands::restore_wiki_pages,
                    commands::restore_wiki_folder,
                    commands::delete_wiki_page,
                    commands::delete_wiki_folder,
                    commands::delete_active_wiki_folder,
                    commands::get_case_filters,
                    commands::search_run_cases,
                    commands::get_run_case_filters,
                    commands::get_case_detail,
                    commands::update_case,
                    commands::link_case_requirement,
                    commands::unlink_case_requirement,
                    commands::post_case_comment,
                    commands::delete_case_comment,
                    commands::get_git_user_name,
                    commands::get_git_profile,
                    commands::set_git_profile,
                    commands::sync_git_user_cache,
                    commands::list_case_templates,
                    commands::get_case_template_content,
                    commands::save_case_template,
                    commands::capture_pending_changes,
                    commands::clear_pending_changes,
                    commands::discard_pending_paths,
                    commands::get_pending_diff_files,
                    commands::get_pending_diff_content,
                    commands::workflow_ensure_draft,
                    commands::workflow_push_failed_status,
                    commands::confirm_changes,
                    commands::resolve_rebase,
                    commands::abort_rebase,
                    commands::recover_confirm_workflow,
                    commands::prefetch_repo,
                    commands::create_run,
                    commands::list_runs,
                    commands::get_run,
                    commands::list_run_cases,
                    commands::list_run_case_paths,
                    commands::get_run_folder_tree,
                    commands::get_run_case_comments,
                    commands::get_run_breakdown,
                    commands::get_project_case_breakdown,
                    commands::get_run_case_content,
                    commands::patch_run,
                    commands::link_run_requirement,
                    commands::unlink_run_requirement,
                    commands::patch_run_case,
                    commands::get_workspace_usernames,
                    commands::approve_run,
                    commands::duplicate_run,
                    commands::add_run_cases,
                    commands::remove_run_cases,
                    commands::post_run_comment,
                    commands::post_run_case_comment,
                    commands::delete_run_comment,
                    commands::delete_run_case_comment,
                    commands::set_run_result,
                    commands::set_run_results_batch,
                    commands::flush_pending_run_yaml,
                    commands::delete_run,
                    commands::restore_run,
                    commands::ensure_baseline_sync,
                    commands::export_cases_pdf,
                    commands::export_runs_pdf,
                    commands::save_test_asset,
                    commands::sync_pending_assets,
                    commands::resolve_and_load_asset,
                    commands::delete_local_asset,
                    commands::sync_automation_executions,
                    commands::list_automation_pipelines,
                    commands::list_automation_executions,
                    commands::get_automation_execution,
                    commands::list_automation_results,
                    commands::list_automation_suites,
                    commands::get_automation_result_detail,
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn auto_fetch_loop(state: &gitoza_rust_backend::AppState, _handle: &tauri::AppHandle) {
    use std::sync::atomic::AtomicUsize;

    let gen = Arc::new(AtomicUsize::new(0));
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if state.active_ws_clients.load(Ordering::SeqCst) == 0 {
            continue;
        }
        let repos_dir = state.config_dir.join("repos");
        let entries = std::fs::read_dir(&repos_dir);
        let Ok(entries) = entries else { continue };
        let mut changed_any = false;
        for entry in entries.flatten() {
            let repo_path = entry.path();
            if !repo_path.is_dir() || !repo_path.join(".git").is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            let git_lock = gitoza_rust_backend::repo_git_lock(state, &slug);
            let _git_guard = git_lock.lock().await;
            if gitoza_rust_backend::fetch_and_pull_if_allowed(state, &slug, &repo_path)
                .await
                .unwrap_or(false)
            {
                changed_any = true;
            }
        }
        if changed_any {
            let my_gen = gen.fetch_add(1, Ordering::SeqCst) + 1;
            let s = state.clone();
            let gen2 = gen.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if gen2.load(Ordering::SeqCst) == my_gen {
                    let _ = gitoza_rust_backend::broadcast_refresh(&s).await;
                }
            });
        }
    }
}
