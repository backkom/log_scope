#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthCheck {
    status: &'static str,
    app_name: &'static str,
    version: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOpenPlaceholder {
    path: String,
    message: &'static str,
}

#[tauri::command]
fn health_check() -> HealthCheck {
    HealthCheck {
        status: "ok",
        app_name: "log_scope",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn open_file_placeholder(path: String) -> FileOpenPlaceholder {
    FileOpenPlaceholder {
        path,
        message: "file open command placeholder ready",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            health_check,
            open_file_placeholder
        ])
        .run(tauri::generate_context!())
        .expect("error while running log_scope");
}
