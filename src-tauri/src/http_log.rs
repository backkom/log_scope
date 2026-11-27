use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use tauri::Emitter;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpServiceLogContext {
    pub server_ip: String,
    pub server_port: u16,
    pub rid: String,
    pub rolename: String,
    pub first_seen_at: Option<String>,
    pub last_seen_at: Option<String>,
}

impl Default for HttpServiceLogContext {
    fn default() -> Self {
        Self {
            server_ip: String::new(),
            server_port: 0,
            rid: String::new(),
            rolename: String::new(),
            first_seen_at: None,
            last_seen_at: None,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpServiceLogItem {
    pub id: u64,
    pub uuid: String,
    pub project: String,
    pub package: String,
    pub platform: String,
    pub udid: String,
    pub file_name: String,
    pub file_size: u64,
    pub is_protected: bool,
    pub contexts: Vec<HttpServiceLogContext>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl Default for HttpServiceLogItem {
    fn default() -> Self {
        Self {
            id: 0,
            uuid: String::new(),
            project: String::new(),
            package: String::new(),
            platform: String::new(),
            udid: String::new(),
            file_name: String::new(),
            file_size: 0,
            is_protected: false,
            contexts: Vec::new(),
            created_at: None,
            updated_at: None,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpServiceLogProject {
    pub name: String,
    pub packages: Vec<String>,
}

impl Default for HttpServiceLogProject {
    fn default() -> Self {
        Self {
            name: String::new(),
            packages: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpServiceLogListResponse {
    pub items: Vec<HttpServiceLogItem>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
    pub order: String,
    pub projects: Vec<HttpServiceLogProject>,
    pub packages: Vec<String>,
}

impl Default for HttpServiceLogListResponse {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            total: 0,
            limit: 100,
            offset: 0,
            order: "desc".to_string(),
            projects: Vec::new(),
            packages: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpOpenMetadata {
    pub session_id: u64,
    pub server_url: String,
    pub log_id: u64,
    pub path: String,
    pub file_size: u64,
    pub line_count: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogHttpStatus {
    pub status: String,
    pub version: u64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub message: Option<String>,
}

#[derive(serde::Deserialize)]
struct ApiEnvelope<T> {
    code: i64,
    message: Option<String>,
    data: Option<T>,
}

#[derive(serde::Deserialize)]
struct MetaPayload {
    log: HttpServiceLogItem,
}

pub struct HttpLogControl {
    pub server_url: String,
    pub log_id: u64,
    pub path: PathBuf,
    pub cancelled: Arc<AtomicBool>,
    pub is_downloading: Arc<AtomicBool>,
    pub remote_deleted: Arc<AtomicBool>,
    pub cleanup_on_exit: Arc<AtomicBool>,
    pub sync_lock: Arc<tauri::async_runtime::Mutex<()>>,
    pub status: Mutex<String>,
    pub status_message: Mutex<Option<String>>,
    pub status_version: Arc<AtomicU64>,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub total_bytes: Mutex<Option<u64>>,
}

impl HttpLogControl {
    pub fn new(server_url: String, log_id: u64, path: PathBuf) -> Self {
        Self {
            server_url,
            log_id,
            path,
            cancelled: Arc::new(AtomicBool::new(false)),
            is_downloading: Arc::new(AtomicBool::new(true)),
            remote_deleted: Arc::new(AtomicBool::new(false)),
            cleanup_on_exit: Arc::new(AtomicBool::new(false)),
            sync_lock: Arc::new(tauri::async_runtime::Mutex::new(())),
            status: Mutex::new("loading".to_string()),
            status_message: Mutex::new(None),
            status_version: Arc::new(AtomicU64::new(0)),
            downloaded_bytes: Arc::new(AtomicU64::new(0)),
            total_bytes: Mutex::new(None),
        }
    }

    pub fn snapshot_status(&self) -> LogHttpStatus {
        loop {
            let version_before = self.status_version.load(Ordering::Acquire);
            let status = self
                .status
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_else(|_| "error".to_string());
            let message = self
                .status_message
                .lock()
                .ok()
                .and_then(|guard| guard.clone());
            let total_bytes = self.total_bytes.lock().ok().and_then(|guard| *guard);
            let downloaded_bytes = self.downloaded_bytes.load(Ordering::Acquire);
            let version_after = self.status_version.load(Ordering::Acquire);
            if version_before == version_after {
                return LogHttpStatus {
                    status,
                    version: version_after,
                    downloaded_bytes,
                    total_bytes,
                    message,
                };
            }
        }
    }
}

pub fn normalize_http_server_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请输入 HTTP 日志服务器 URL".to_string());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let parsed = reqwest::Url::parse(&with_scheme)
        .map_err(|err| format!("无效的服务器 URL: {err}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("仅支持 http:// 或 https:// 协议".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("服务器 URL 缺少主机名或 IP".to_string());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn build_http_meta_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn safe_http_filename_part(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|ch| ch == '.' || ch == '_');
    if trimmed.is_empty() {
        "service".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub async fn fetch_service_log_list(
    client: &reqwest::Client,
    server_url: &str,
    project: Option<&str>,
    package: Option<&str>,
    rid: Option<&str>,
    rolename: Option<&str>,
    udid: Option<&str>,
    limit: Option<u32>,
) -> Result<HttpServiceLogListResponse, String> {
    let base_url = normalize_http_server_url(server_url)?;
    let endpoint = format!("{base_url}/api/service_logs/recent");
    let mut url = reqwest::Url::parse(&endpoint)
        .map_err(|err| format!("构造请求 URL 失败: {err}"))?;

    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("limit", &limit.unwrap_or(100).to_string());
        pairs.append_pair("order", "desc");
        if let Some(value) = project.map(str::trim).filter(|v| !v.is_empty()) {
            pairs.append_pair("project", value);
        }
        if let Some(value) = package.map(str::trim).filter(|v| !v.is_empty()) {
            pairs.append_pair("package", value);
        }
        if let Some(value) = rid.map(str::trim).filter(|v| !v.is_empty()) {
            pairs.append_pair("rid", value);
        }
        if let Some(value) = rolename.map(str::trim).filter(|v| !v.is_empty()) {
            pairs.append_pair("rolename", value);
        }
        if let Some(value) = udid.map(str::trim).filter(|v| !v.is_empty()) {
            pairs.append_pair("udid", value);
        }
    }

    let response = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("请求日志列表失败: {err}"))?;
    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|err| format!("读取服务器响应失败: {err}"))?;

    let envelope: ApiEnvelope<HttpServiceLogListResponse> = serde_json::from_str(&body_text)
        .map_err(|err| format!("解析服务器响应失败 (HTTP {status}): {err}"))?;
    if !status.is_success() || envelope.code != 0 {
        let message = envelope
            .message
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(message);
    }
    Ok(envelope.data.unwrap_or_default())
}

pub async fn fetch_remote_file_size(
    client: &reqwest::Client,
    control: &HttpLogControl,
) -> Option<u64> {
    if control.cancelled.load(Ordering::Acquire) || control.remote_deleted.load(Ordering::Acquire) {
        return None;
    }
    let url = format!("{}/api/service_logs/{}/meta", control.server_url, control.log_id);
    let response = client.get(&url).send().await.ok()?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        control.remote_deleted.store(true, Ordering::Release);
        return None;
    }
    if !response.status().is_success() {
        return None;
    }
    let envelope = response.json::<ApiEnvelope<MetaPayload>>().await.ok()?;
    if envelope.code != 0 {
        return None;
    }
    envelope.data.map(|payload| payload.log.file_size)
}

pub fn emit_http_status(
    app: &tauri::AppHandle,
    session_id: u64,
    control: &HttpLogControl,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: Option<String>,
) {
    if let Ok(mut guard) = control.status.lock() {
        *guard = status.to_string();
    }
    if let Ok(mut guard) = control.status_message.lock() {
        *guard = message.clone();
    }
    if let Ok(mut guard) = control.total_bytes.lock() {
        *guard = total_bytes;
    }
    control.downloaded_bytes.store(downloaded_bytes, Ordering::Release);
    let version = control.status_version.fetch_add(1, Ordering::AcqRel) + 1;
    let _ = app.emit(
        "log-http-status",
        serde_json::json!({
            "sessionId": session_id,
            "status": status,
            "version": version,
            "downloadedBytes": downloaded_bytes,
            "totalBytes": total_bytes,
            "message": message,
        }),
    );
}

fn header_u64(headers: &reqwest::header::HeaderMap, name: &str) -> Option<u64> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|text| text.trim().parse::<u64>().ok())
}

pub async fn run_initial_http_download(
    client: reqwest::Client,
    app: tauri::AppHandle,
    session_id: u64,
    control: Arc<HttpLogControl>,
) {
    {
        let _lock = control.sync_lock.lock().await;
        emit_http_status(&app, session_id, &control, "loading", 0, None, None);

        let result = stream_download_from_offset(&client, &app, session_id, &control, 0, true).await;
        match result {
            Ok(Some((downloaded, total))) => {
                if !control.cancelled.load(Ordering::Acquire) {
                    emit_http_status(&app, session_id, &control, "connected", downloaded, total, None);
                }
            }
            Ok(None) => {
                // 204 or 404 already updated status
            }
            Err(err) => {
                if !control.cancelled.load(Ordering::Acquire) {
                    emit_http_status(&app, session_id, &control, "error", control.downloaded_bytes.load(Ordering::Acquire), None, Some(err));
                }
            }
        }
    }

    control.is_downloading.store(false, Ordering::Release);
    if control.cleanup_on_exit.load(Ordering::Acquire) {
        let path = control.path.clone();
        std::thread::spawn(move || cleanup_http_log_file(&path));
    }
}

pub async fn sync_http_log_delta(
    client: &reqwest::Client,
    app: &tauri::AppHandle,
    session_id: u64,
    control: &HttpLogControl,
) -> Result<(), String> {
    if control.cancelled.load(Ordering::Acquire)
        || control.is_downloading.load(Ordering::Acquire)
        || control.remote_deleted.load(Ordering::Acquire)
    {
        return Ok(());
    }

    let Ok(_lock) = control.sync_lock.try_lock() else {
        return Ok(());
    };

    if control.cancelled.load(Ordering::Acquire)
        || control.is_downloading.load(Ordering::Acquire)
        || control.remote_deleted.load(Ordering::Acquire)
    {
        return Ok(());
    }

    let local_offset = fs::metadata(&control.path).map(|meta| meta.len()).unwrap_or(0);
    match stream_download_from_offset(client, app, session_id, control, local_offset, false).await {
        Ok(Some((downloaded, total))) => {
            if !control.cancelled.load(Ordering::Acquire) {
                emit_http_status(app, session_id, control, "connected", downloaded, total, None);
            }
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(err) => {
            if !control.cancelled.load(Ordering::Acquire) {
                let current_bytes = fs::metadata(&control.path).map(|meta| meta.len()).unwrap_or(0);
                emit_http_status(app, session_id, control, "error", current_bytes, None, Some(err));
            }
            Ok(())
        }
    }
}

async fn stream_download_from_offset(
    client: &reqwest::Client,
    app: &tauri::AppHandle,
    session_id: u64,
    control: &HttpLogControl,
    offset: u64,
    emit_progress: bool,
) -> Result<Option<(u64, Option<u64>)>, String> {
    let url = format!(
        "{}/api/service_logs/{}/download?offset={}",
        control.server_url, control.log_id, offset
    );
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("连接日志服务器失败: {err}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        control.remote_deleted.store(true, Ordering::Release);
        let current_bytes = fs::metadata(&control.path).map(|meta| meta.len()).unwrap_or(0);
        emit_http_status(
            app,
            session_id,
            control,
            "disconnected",
            current_bytes,
            Some(current_bytes),
            Some("服务器上的日志已不存在，已保留本地已下载内容".to_string()),
        );
        return Ok(None);
    }

    if status == reqwest::StatusCode::NO_CONTENT {
        let remote_size = header_u64(response.headers(), "x-log-file-size").or(Some(offset));
        let prev_status = control
            .status
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        if prev_status != "connected" {
            emit_http_status(app, session_id, control, "connected", offset, remote_size, None);
        }
        return Ok(None);
    }

    if !status.is_success() {
        return Err(format!("下载日志失败 (HTTP {status})"));
    }

    let truncated = response
        .headers()
        .get("x-log-truncated")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim() == "1");
    let total_bytes = header_u64(response.headers(), "x-log-file-size")
        .or_else(|| response.content_length().map(|len| if truncated { len } else { offset + len }));

    let file = if truncated || offset == 0 {
        File::options()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&control.path)
            .map_err(|err| format!("打开本地缓存文件失败: {err}"))?
    } else {
        File::options()
            .create(true)
            .append(true)
            .open(&control.path)
            .map_err(|err| format!("打开本地缓存文件失败: {err}"))?
    };

    let mut writer = BufWriter::with_capacity(256 * 1024, file);
    let mut written_total = if truncated || offset == 0 { 0 } else { offset };
    let mut buffered_since_flush = 0_usize;
    let mut last_notify = Instant::now();
    let mut notified_once = false;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("接收日志流失败: {err}"))?
    {
        if control.cancelled.load(Ordering::Acquire) {
            break;
        }
        if chunk.is_empty() {
            continue;
        }
        writer
            .write_all(&chunk)
            .map_err(|err| format!("写入本地缓存文件失败: {err}"))?;
        written_total += chunk.len() as u64;
        buffered_since_flush += chunk.len();

        if emit_progress && (buffered_since_flush >= 256 * 1024 || last_notify.elapsed() >= Duration::from_millis(150)) {
            writer
                .flush()
                .map_err(|err| format!("刷新本地缓存文件失败: {err}"))?;
            buffered_since_flush = 0;
            last_notify = Instant::now();
            notified_once = true;
            let _ = app.emit(
                "log-source-changed",
                serde_json::json!({ "sessionId": session_id }),
            );
            emit_http_status(app, session_id, control, "loading", written_total, total_bytes, None);
        }
    }

    writer
        .flush()
        .map_err(|err| format!("刷新本地缓存文件失败: {err}"))?;
    if emit_progress && (written_total > 0 || notified_once) && !control.cancelled.load(Ordering::Acquire) {
        let _ = app.emit(
            "log-source-changed",
            serde_json::json!({ "sessionId": session_id }),
        );
    }

    Ok(Some((written_total, total_bytes.or(Some(written_total)))))
}

pub fn cleanup_http_log_file(path: &PathBuf) {
    for _ in 0..600 {
        match fs::remove_file(path) {
            Ok(()) => return,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    eprintln!("log_scope could not remove http log file: {}", path.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_http_server_urls() {
        assert_eq!(
            normalize_http_server_url("  127.0.0.1:7848/  ").unwrap(),
            "http://127.0.0.1:7848"
        );
        assert_eq!(
            normalize_http_server_url("https://logs.example.com/sub/").unwrap(),
            "https://logs.example.com/sub"
        );
        assert!(normalize_http_server_url("   ").is_err());
        assert!(normalize_http_server_url("ftp://127.0.0.1:21").is_err());
    }

    #[test]
    fn sanitizes_http_filename_parts() {
        assert_eq!(safe_http_filename_part("client.log"), "client.log");
        assert_eq!(safe_http_filename_part("../bad/name:1.log"), "bad_name_1.log");
        assert_eq!(safe_http_filename_part("..."), "service");
    }

    #[test]
    fn deserializes_http_service_log_list_response() {
        let raw = r#"{
            "code": 0,
            "message": "Recent service logs queried",
            "data": {
                "items": [{
                    "id": 12,
                    "uuid": "550e8400-e29b-41d4-a716-446655440000",
                    "project": "Monster",
                    "package": "com.monster.win",
                    "platform": "Windows",
                    "udid": "pc-001",
                    "fileName": "client.log",
                    "fileSize": 2048,
                    "isProtected": true,
                    "contexts": [{
                        "serverIp": "10.0.0.1",
                        "serverPort": 7848,
                        "rid": "1001",
                        "rolename": "Hero"
                    }],
                    "createdAt": "2026-11-27 09:00:00",
                    "updatedAt": "2026-11-27 09:01:00"
                }],
                "total": 1,
                "limit": 100,
                "offset": 0,
                "order": "desc",
                "projects": [{"name": "Monster", "packages": ["com.monster.win"]}],
                "packages": ["com.monster.win"]
            }
        }"#;
        let parsed: ApiEnvelope<HttpServiceLogListResponse> = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.code, 0);
        let data = parsed.data.unwrap();
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].id, 12);
        assert_eq!(data.items[0].package, "com.monster.win");
        assert_eq!(data.items[0].contexts[0].rolename, "Hero");
        assert_eq!(data.projects[0].name, "Monster");
    }
}
