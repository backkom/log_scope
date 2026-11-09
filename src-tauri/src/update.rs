use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Minimum interval between download progress events so a fast connection cannot
/// flood the webview event bridge with per-chunk updates.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Version announced by the last successful check. The native menu reads this to
/// show the red update dot without opening any dialog.
static AVAILABLE_UPDATE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    /// One of: checking, available, downloading, installing, up-to-date, error.
    stage: &'static str,
    current_version: String,
    version: Option<String>,
    downloaded: u64,
    content_length: Option<u64>,
    message: Option<String>,
}

impl UpdateStatus {
    fn new(stage: &'static str, current_version: &str) -> Self {
        Self {
            stage,
            current_version: current_version.to_string(),
            version: None,
            downloaded: 0,
            content_length: None,
            message: None,
        }
    }
}

fn emit_status(app: &AppHandle, status: UpdateStatus) {
    let _ = app.emit("update-status", status);
}

fn emit_failure(app: &AppHandle, current_version: &str, message: String) {
    let mut status = UpdateStatus::new("error", current_version);
    status.message = Some(message);
    emit_status(app, status);
}

/// Returns the newer version found by the latest check, if any.
pub fn available_version() -> Option<String> {
    match AVAILABLE_UPDATE.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn set_available_version(version: Option<String>) {
    match AVAILABLE_UPDATE.lock() {
        Ok(mut guard) => *guard = version,
        Err(poisoned) => *poisoned.into_inner() = version,
    }
}

/// Silent check used at startup: it never emits the update dialog events. When a
/// newer release exists it records the version and rebuilds the native menu so
/// the update item shows a red dot. The user still decides whether to install it.
pub fn check_for_updates_on_startup(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(updater) => updater,
            Err(_) => return,
        };

        if let Ok(Some(update)) = updater.check().await {
            set_available_version(Some(update.version.clone()));
            crate::deferred_update_app_menu(&app);
        }
    });
}

/// Check GitHub Releases for a newer signed build. When one exists it is downloaded,
/// the running installation is replaced in place, and the app is relaunched.
///
/// Windows: the Tauri updater launches the NSIS/MSI installer in passive mode with
/// `/UPDATE`; the installer restarts the app, so this process exits before returning.
/// macOS: the `.app` bundle is swapped atomically (admin prompt when required) and
/// `app.restart()` launches the new version.
pub fn check_for_updates(app: AppHandle) {
    if UPDATE_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let current_version = app.package_info().version.to_string();
        emit_status(&app, UpdateStatus::new("checking", &current_version));

        let updater = match app.updater() {
            Ok(updater) => updater,
            Err(error) => {
                emit_failure(&app, &current_version, error.to_string());
                UPDATE_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
        };

        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                set_available_version(None);
                crate::deferred_update_app_menu(&app);
                emit_status(&app, UpdateStatus::new("up-to-date", &current_version));
                UPDATE_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
            Err(error) => {
                emit_failure(&app, &current_version, error.to_string());
                UPDATE_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
        };

        let version = update.version.clone();
        set_available_version(Some(version.clone()));
        crate::deferred_update_app_menu(&app);

        let mut available = UpdateStatus::new("available", &current_version);
        available.version = Some(version.clone());
        emit_status(&app, available);

        let progress_app = app.clone();
        let install_app = app.clone();
        let progress_version = version.clone();
        let install_version = version.clone();
        let progress_current_version = current_version.clone();
        let install_current_version = current_version.clone();

        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now()
            .checked_sub(PROGRESS_INTERVAL)
            .unwrap_or_else(Instant::now);

        let result = update
            .download_and_install(
                move |chunk_length, content_length| {
                    downloaded = downloaded.saturating_add(chunk_length as u64);
                    if last_emit.elapsed() < PROGRESS_INTERVAL {
                        return;
                    }
                    last_emit = Instant::now();

                    let mut status = UpdateStatus::new("downloading", &progress_current_version);
                    status.version = Some(progress_version.clone());
                    status.downloaded = downloaded;
                    status.content_length = content_length;
                    emit_status(&progress_app, status);
                },
                move || {
                    let mut status = UpdateStatus::new("installing", &install_current_version);
                    status.version = Some(install_version.clone());
                    emit_status(&install_app, status);
                },
            )
            .await;

        if let Err(error) = result {
            emit_failure(&app, &current_version, error.to_string());
            UPDATE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }

        app.restart();
    });
}
