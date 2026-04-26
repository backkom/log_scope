use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::TcpStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
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

#[derive(Default)]
struct AppState {
    next_session_id: AtomicU64,
    sessions: Mutex<HashMap<u64, Arc<Mutex<LogSession>>>>,
}

struct LogSession {
    path: PathBuf,
    file_size: u64,
    line_offsets: Vec<u64>,
    markers: Vec<LogMarker>,
    marker_payloads: HashMap<String, MarkerPayload>,
    index_duration_ms: u128,
    ended_with_newline: bool,
}

struct SearchSnapshot {
    path: PathBuf,
    line_offsets: Vec<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogFileMetadata {
    session_id: u64,
    path: String,
    file_size: u64,
    line_count: usize,
    index_duration_ms: u128,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogRefreshMetadata {
    session_id: u64,
    path: String,
    file_size: u64,
    line_count: usize,
    marker_count: usize,
    appended_bytes: u64,
    appended_lines: usize,
    was_truncated: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureMetadata {
    path: String,
    file_size: u64,
    line_count: usize,
    profile: String,
    generation_duration_ms: u128,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreBenchmarkReport {
    fixture: FixtureMetadata,
    index_duration_ms: u128,
    marker_count: usize,
    search_duration_ms: u128,
    search_total_matches: usize,
    read_visible_duration_ms: u128,
    read_visible_line_count: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketConnectMetadata {
    session_id: u64,
    host: String,
    port: u16,
    path: String,
    line_count: usize,
    protocol: &'static str,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedStore {
    schema_version: u32,
    recent_files: Vec<PersistedFileSource>,
    recent_sockets: Vec<PersistedSocketSource>,
    last_source: Option<PersistedDataSource>,
    ui_state: PersistedUiState,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedFileSource {
    path: String,
    display_name: String,
    last_opened_at: u64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSocketSource {
    host: String,
    port: u16,
    display_name: String,
    last_opened_at: u64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDataSource {
    kind: String,
    path: Option<String>,
    host: Option<String>,
    port: Option<u16>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedUiState {
    follow_tail: bool,
    show_global_minimap: bool,
    show_local_minimap: bool,
    log_color_mode: String,
    search_query: String,
    search_case_sensitive: bool,
    search_regex: bool,
    search_whole_word: bool,
    search_wrap_around: bool,
    search_find_all: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLine {
    line_number: usize,
    text: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLineRange {
    session_id: u64,
    start_line: usize,
    line_count: usize,
    total_lines: usize,
    lines: Vec<LogLine>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogMarker {
    id: String,
    kind: String,
    title: String,
    color: String,
    start_line: usize,
    end_line: usize,
    start_byte: u64,
    end_byte: u64,
    line_time: String,
    direction: String,
    message_id: u64,
    message_name: String,
    lane_ratio: f64,
    parse_status: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkerPayload {
    marker_id: String,
    raw_text: String,
    parse_status: String,
    parsed_json: Option<serde_json::Value>,
    parse_error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogMarkerRange {
    session_id: u64,
    total_markers: usize,
    markers: Vec<LogMarker>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSearchMatch {
    line_number: usize,
    start_column: usize,
    end_column: usize,
    line_preview: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSearchResult {
    session_id: u64,
    query: String,
    direction: String,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
    start_line: usize,
    scanned_lines: usize,
    total_lines: usize,
    total_matches: usize,
    active_match_index: usize,
    duration_ms: u128,
    truncated: bool,
    wrapped: bool,
    matches: Vec<LogSearchMatch>,
}

#[derive(Clone)]
struct SearchCandidate {
    line_number: usize,
    start_column: usize,
    end_column: usize,
    line_preview: String,
    match_index: usize,
}

struct MessageHeader {
    line_time: String,
    direction: String,
    message_id: u64,
    message_name: String,
}

struct OpenMarker {
    header: MessageHeader,
    id: String,
    start_line: usize,
    start_byte: u64,
    body_lines: Vec<String>,
}

struct OpenTextBlock {
    id: String,
    kind: String,
    title: String,
    color: String,
    line_time: String,
    start_line: usize,
    start_byte: u64,
    lines: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocketFrame {
    version: u16,
    record_type: String,
    payload: Option<String>,
    records: Option<Vec<SocketRecord>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocketRecord {
    text: String,
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

#[tauri::command]
async fn open_log_file(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LogFileMetadata, String> {
    let path_buf = PathBuf::from(path);
    let session = tauri::async_runtime::spawn_blocking(move || LogSession::open(path_buf))
        .await
        .map_err(|err| format!("failed to join file indexing task: {err}"))?
        .map_err(|err| err.to_string())?;
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;
    let metadata = LogFileMetadata {
        session_id,
        path: session.path.to_string_lossy().into_owned(),
        file_size: session.file_size,
        line_count: session.line_offsets.len(),
        index_duration_ms: session.index_duration_ms,
    };

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "log session state is unavailable".to_string())?;
    sessions.insert(session_id, Arc::new(Mutex::new(session)));
    remember_recent_file(&app, metadata.path.clone())?;

    Ok(metadata)
}

#[tauri::command]
async fn generate_log_fixture(
    size_mb: u64,
    profile: Option<String>,
) -> Result<FixtureMetadata, String> {
    let safe_size_mb = size_mb.clamp(1, 512);
    let profile = normalize_fixture_profile(profile);
    tauri::async_runtime::spawn_blocking(move || generate_fixture(safe_size_mb, &profile))
        .await
        .map_err(|err| format!("failed to join fixture generation task: {err}"))?
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn run_core_benchmark(
    size_mb: u64,
    profile: Option<String>,
) -> Result<CoreBenchmarkReport, String> {
    let safe_size_mb = size_mb.clamp(1, 512);
    let profile = normalize_fixture_profile(profile);
    tauri::async_runtime::spawn_blocking(move || run_core_benchmark_sync(safe_size_mb, &profile))
        .await
        .map_err(|err| format!("failed to join core benchmark task: {err}"))?
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn connect_log_socket(
    host: String,
    port: u16,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SocketConnectMetadata, String> {
    let normalized_host = host.trim().to_string();
    if normalized_host.is_empty() {
        return Err("请输入 socket host".to_string());
    }

    let address = format!("{normalized_host}:{port}");
    let stream = tauri::async_runtime::spawn_blocking(move || TcpStream::connect(address))
        .await
        .map_err(|err| format!("failed to join socket connect task: {err}"))?
        .map_err(|err| format!("failed to connect socket: {err}"))?;

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let socket_dir = std::env::temp_dir().join("log_scope").join("socket");
    fs::create_dir_all(&socket_dir)
        .map_err(|err| format!("failed to create socket log dir: {err}"))?;
    let safe_host = safe_socket_filename_part(&normalized_host);
    let path = socket_dir.join(format!("socket-{safe_host}-{port}-{suffix}.log"));
    File::create(&path).map_err(|err| format!("failed to create socket log file: {err}"))?;

    let session = LogSession::open(path.clone()).map_err(|err| err.to_string())?;
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        sessions.insert(session_id, Arc::new(Mutex::new(session)));
    }

    let writer_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = read_socket_frames_to_file(stream, writer_path) {
            eprintln!("log_scope socket reader stopped: {err}");
        }
    });

    remember_recent_socket(&app, normalized_host.clone(), port)?;

    Ok(SocketConnectMetadata {
        session_id,
        host: normalized_host,
        port,
        path: path.to_string_lossy().into_owned(),
        line_count: 0,
        protocol: "logscope-frame-v1",
    })
}

#[tauri::command]
fn get_persisted_state(app: tauri::AppHandle) -> Result<PersistedStore, String> {
    load_persisted_store(&app).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_ui_state(
    ui_state: PersistedUiState,
    app: tauri::AppHandle,
) -> Result<PersistedStore, String> {
    let mut store = load_persisted_store(&app).map_err(|err| err.to_string())?;
    store.ui_state = sanitize_ui_state(ui_state);
    save_persisted_store(&app, &store).map_err(|err| err.to_string())?;
    Ok(store)
}

#[tauri::command]
fn remove_recent_file(path: String, app: tauri::AppHandle) -> Result<PersistedStore, String> {
    let mut store = load_persisted_store(&app).map_err(|err| err.to_string())?;
    store.recent_files.retain(|source| source.path != path);
    if store.last_source.as_ref().is_some_and(|source| {
        source.kind == "file" && source.path.as_deref() == Some(path.as_str())
    }) {
        store.last_source = None;
    }
    save_persisted_store(&app, &store).map_err(|err| err.to_string())?;
    load_persisted_store(&app).map_err(|err| err.to_string())
}

#[tauri::command]
fn remove_recent_socket(
    host: String,
    port: u16,
    app: tauri::AppHandle,
) -> Result<PersistedStore, String> {
    let mut store = load_persisted_store(&app).map_err(|err| err.to_string())?;
    store
        .recent_sockets
        .retain(|source| source.host != host || source.port != port);
    if store.last_source.as_ref().is_some_and(|source| {
        source.kind == "socket"
            && source.host.as_deref() == Some(host.as_str())
            && source.port == Some(port)
    }) {
        store.last_source = None;
    }
    save_persisted_store(&app, &store).map_err(|err| err.to_string())?;
    load_persisted_store(&app).map_err(|err| err.to_string())
}

#[tauri::command]
fn get_log_lines(
    session_id: u64,
    start_line: usize,
    line_count: usize,
    state: tauri::State<'_, AppState>,
) -> Result<LogLineRange, String> {
    let session = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        Arc::clone(
            sessions
                .get(&session_id)
                .ok_or_else(|| format!("log session {session_id} was not found"))?,
        )
    };

    let session = session
        .lock()
        .map_err(|_| format!("log session {session_id} is unavailable"))?;

    session
        .read_lines(session_id, start_line, line_count)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn get_log_markers(
    session_id: u64,
    start_line: Option<usize>,
    end_line: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<LogMarkerRange, String> {
    let session = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        Arc::clone(
            sessions
                .get(&session_id)
                .ok_or_else(|| format!("log session {session_id} was not found"))?,
        )
    };

    let session = session
        .lock()
        .map_err(|_| format!("log session {session_id} is unavailable"))?;
    let start_line = start_line.unwrap_or(1);
    let end_line = end_line.unwrap_or(usize::MAX);
    let markers = session
        .markers
        .iter()
        .filter(|marker| marker.end_line >= start_line && marker.start_line <= end_line)
        .cloned()
        .collect::<Vec<_>>();

    Ok(LogMarkerRange {
        session_id,
        total_markers: session.markers.len(),
        markers,
    })
}

#[tauri::command]
fn get_marker_payload(
    session_id: u64,
    marker_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<MarkerPayload, String> {
    let session = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        Arc::clone(
            sessions
                .get(&session_id)
                .ok_or_else(|| format!("log session {session_id} was not found"))?,
        )
    };

    let session = session
        .lock()
        .map_err(|_| format!("log session {session_id} is unavailable"))?;
    session
        .marker_payloads
        .get(&marker_id)
        .cloned()
        .ok_or_else(|| format!("marker {marker_id} was not found"))
}

#[tauri::command]
async fn refresh_log_file(
    session_id: u64,
    state: tauri::State<'_, AppState>,
) -> Result<LogRefreshMetadata, String> {
    let session = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        Arc::clone(
            sessions
                .get(&session_id)
                .ok_or_else(|| format!("log session {session_id} was not found"))?,
        )
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut session = session
            .lock()
            .map_err(|_| format!("log session {session_id} is unavailable"))?;
        session.refresh(session_id).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("failed to join file refresh task: {err}"))?
}

#[tauri::command]
async fn search_log_text(
    session_id: u64,
    query: String,
    start_line: Option<usize>,
    start_column: Option<usize>,
    direction: String,
    case_sensitive: bool,
    use_regex: Option<bool>,
    whole_word: Option<bool>,
    wrap_around: Option<bool>,
    find_all: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<LogSearchResult, String> {
    let session = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "log session state is unavailable".to_string())?;
        Arc::clone(
            sessions
                .get(&session_id)
                .ok_or_else(|| format!("log session {session_id} was not found"))?,
        )
    };

    let use_regex = use_regex.unwrap_or(false);
    let whole_word = whole_word.unwrap_or(false);
    let find_all = find_all.unwrap_or(true);

    let snapshot = {
        let session = session
            .lock()
            .map_err(|_| format!("log session {session_id} is unavailable"))?;
        session.search_snapshot()
    };

    tauri::async_runtime::spawn_blocking(move || {
        search_text_snapshot(
            session_id,
            snapshot,
            query,
            start_line.unwrap_or(1),
            start_column.unwrap_or(0),
            direction,
            case_sensitive,
            use_regex,
            whole_word,
            wrap_around.unwrap_or(true),
            find_all,
        )
        .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("failed to join log search task: {err}"))?
}

impl LogSession {
    fn open(path: PathBuf) -> std::io::Result<Self> {
        let started_at = Instant::now();
        let file = File::open(&path)?;
        let file_size = file.metadata()?.len();
        let (line_offsets, ended_with_newline) = build_line_index(file, file_size)?;
        let (markers, marker_payloads) = scan_log_markers(&path, file_size)?;
        let index_duration_ms = started_at.elapsed().as_millis();

        Ok(Self {
            path,
            file_size,
            line_offsets,
            markers,
            marker_payloads,
            index_duration_ms,
            ended_with_newline,
        })
    }

    fn refresh(&mut self, session_id: u64) -> std::io::Result<LogRefreshMetadata> {
        let metadata = fs::metadata(&self.path)?;
        let new_file_size = metadata.len();
        let old_file_size = self.file_size;
        let old_line_count = self.line_offsets.len();

        if new_file_size < old_file_size {
            let file = File::open(&self.path)?;
            let (line_offsets, ended_with_newline) = build_line_index(file, new_file_size)?;
            self.file_size = new_file_size;
            self.line_offsets = line_offsets;
            self.ended_with_newline = ended_with_newline;
            self.rebuild_markers()?;

            return Ok(self.refresh_metadata(
                session_id,
                0,
                self.line_offsets.len().saturating_sub(old_line_count),
                true,
            ));
        }

        if new_file_size == old_file_size {
            return Ok(self.refresh_metadata(session_id, 0, 0, false));
        }

        let appended_bytes = new_file_size - old_file_size;
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(old_file_size))?;
        let mut buffer = vec![0; appended_bytes as usize];
        file.read_exact(&mut buffer)?;

        if self.line_offsets.is_empty() && !buffer.is_empty() {
            self.line_offsets.push(0);
        } else if self.ended_with_newline && !buffer.is_empty() {
            self.line_offsets.push(old_file_size);
        }

        for (index, byte) in buffer.iter().enumerate() {
            if *byte == b'\n' {
                let next_offset = old_file_size + index as u64 + 1;
                if next_offset < new_file_size {
                    self.line_offsets.push(next_offset);
                }
            }
        }

        self.file_size = new_file_size;
        self.ended_with_newline = buffer.last().is_some_and(|byte| *byte == b'\n');
        self.rebuild_markers()?;

        Ok(self.refresh_metadata(
            session_id,
            appended_bytes,
            self.line_offsets.len().saturating_sub(old_line_count),
            false,
        ))
    }

    fn refresh_metadata(
        &self,
        session_id: u64,
        appended_bytes: u64,
        appended_lines: usize,
        was_truncated: bool,
    ) -> LogRefreshMetadata {
        LogRefreshMetadata {
            session_id,
            path: self.path.to_string_lossy().into_owned(),
            file_size: self.file_size,
            line_count: self.line_offsets.len(),
            marker_count: self.markers.len(),
            appended_bytes,
            appended_lines,
            was_truncated,
        }
    }

    fn rebuild_markers(&mut self) -> std::io::Result<()> {
        let (markers, marker_payloads) = scan_log_markers(&self.path, self.file_size)?;
        self.markers = markers;
        self.marker_payloads = marker_payloads;
        Ok(())
    }

    fn search_snapshot(&self) -> SearchSnapshot {
        SearchSnapshot {
            path: self.path.clone(),
            line_offsets: self.line_offsets.clone(),
        }
    }

    fn read_lines(
        &self,
        session_id: u64,
        start_line: usize,
        line_count: usize,
    ) -> std::io::Result<LogLineRange> {
        let total_lines = self.line_offsets.len();
        if total_lines == 0 || line_count == 0 {
            return Ok(LogLineRange {
                session_id,
                start_line: 1,
                line_count: 0,
                total_lines,
                lines: Vec::new(),
            });
        }

        let normalized_start = start_line.clamp(1, total_lines);
        let end_line = normalized_start
            .saturating_add(line_count)
            .saturating_sub(1)
            .min(total_lines);
        let start_offset = self.line_offsets[normalized_start - 1];
        let end_offset = if end_line < total_lines {
            self.line_offsets[end_line]
        } else {
            self.file_size
        };
        let byte_count = end_offset.saturating_sub(start_offset);

        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(start_offset))?;
        let mut buffer = vec![0; byte_count as usize];
        file.read_exact(&mut buffer)?;

        let lines = split_lines(&buffer)
            .into_iter()
            .enumerate()
            .map(|(index, text)| LogLine {
                line_number: normalized_start + index,
                text,
            })
            .collect::<Vec<_>>();

        Ok(LogLineRange {
            session_id,
            start_line: normalized_start,
            line_count: lines.len(),
            total_lines,
            lines,
        })
    }
}

fn search_text_snapshot(
    session_id: u64,
    snapshot: SearchSnapshot,
    query: String,
    start_line: usize,
    start_column: usize,
    direction: String,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
    wrap_around: bool,
    find_all: bool,
) -> std::io::Result<LogSearchResult> {
    let started_at = Instant::now();
    let total_lines = snapshot.line_offsets.len();
    let safe_start_line = start_line.clamp(1, total_lines.max(1));

    if query.is_empty() || total_lines == 0 {
        return Ok(LogSearchResult {
            session_id,
            query,
            direction,
            case_sensitive,
            use_regex,
            whole_word,
            start_line: safe_start_line,
            scanned_lines: 0,
            total_lines,
            total_matches: 0,
            active_match_index: 0,
            duration_ms: started_at.elapsed().as_millis(),
            truncated: false,
            wrapped: false,
            matches: Vec::new(),
        });
    }

    let pattern = build_search_pattern(&query, case_sensitive, use_regex, whole_word)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidInput, err))?;
    let forward = direction != "previous";
    let mut file = File::open(&snapshot.path)?;
    let mut reader = BufReader::with_capacity(1024 * 1024, &mut file);
    let mut raw_line = Vec::new();
    let mut scanned_lines = 0_usize;
    let mut total_matches = 0_usize;
    let mut all_matches: Vec<SearchCandidate> = Vec::new();
    let mut first_match: Option<SearchCandidate> = None;
    let mut first_after_cursor: Option<SearchCandidate> = None;
    let mut last_before_cursor: Option<SearchCandidate> = None;
    let mut last_match: Option<SearchCandidate> = None;

    for line_number in 1..=total_lines {
        raw_line.clear();
        reader.read_until(b'\n', &mut raw_line)?;
        scanned_lines += 1;

        let text = decode_log_line(&raw_line);
        for mat in pattern.find_iter(&text) {
            total_matches += 1;
            let candidate = SearchCandidate {
                line_number,
                start_column: mat.start(),
                end_column: mat.end(),
                line_preview: preview_line(&text),
                match_index: total_matches,
            };

            if first_match.is_none() {
                first_match = Some(candidate.clone());
            }
            if is_after_cursor(line_number, mat.start(), safe_start_line, start_column)
                && first_after_cursor.is_none()
            {
                first_after_cursor = Some(candidate.clone());
            }
            if is_before_cursor(line_number, mat.start(), safe_start_line, start_column) {
                last_before_cursor = Some(candidate.clone());
            }
            if find_all {
                all_matches.push(candidate.clone());
            }
            last_match = Some(candidate);

            if !find_all && forward && first_after_cursor.is_some() {
                break;
            }
        }

        if !find_all && forward && first_after_cursor.is_some() {
            break;
        }
        if !find_all && !forward && !wrap_around && line_number > safe_start_line {
            break;
        }
    }

    let (matched, wrapped) = if forward {
        match first_after_cursor {
            Some(candidate) => (Some(candidate), false),
            None if wrap_around => {
                let wrapped = first_match.is_some();
                (first_match, wrapped)
            }
            None => (None, false),
        }
    } else {
        match last_before_cursor {
            Some(candidate) => (Some(candidate), false),
            None if wrap_around => {
                let wrapped = last_match.is_some();
                (last_match, wrapped)
            }
            None => (None, false),
        }
    };

    Ok(search_result(
        session_id,
        query,
        direction,
        case_sensitive,
        use_regex,
        whole_word,
        safe_start_line,
        scanned_lines,
        total_lines,
        total_matches,
        started_at,
        wrapped,
        matched,
        if find_all { all_matches } else { Vec::new() },
    ))
}

fn build_search_pattern(
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
) -> Result<Regex, String> {
    let body = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if whole_word {
        format!(r"\b(?:{})\b", body)
    } else {
        body
    };
    let pattern = if case_sensitive {
        pattern
    } else {
        format!("(?i:{})", pattern)
    };
    let regex = Regex::new(&pattern).map_err(|err| format!("invalid search pattern: {err}"))?;
    if regex.is_match("") {
        return Err("search pattern must not match empty text".to_string());
    }
    Ok(regex)
}

fn is_after_cursor(
    line_number: usize,
    match_column: usize,
    start_line: usize,
    start_column: usize,
) -> bool {
    line_number > start_line || (line_number == start_line && match_column >= start_column)
}

fn is_before_cursor(
    line_number: usize,
    match_column: usize,
    start_line: usize,
    start_column: usize,
) -> bool {
    line_number < start_line || (line_number == start_line && match_column < start_column)
}

fn search_result(
    session_id: u64,
    query: String,
    direction: String,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
    start_line: usize,
    scanned_lines: usize,
    total_lines: usize,
    total_matches: usize,
    started_at: Instant,
    wrapped: bool,
    matched: Option<SearchCandidate>,
    all_matches: Vec<SearchCandidate>,
) -> LogSearchResult {
    let active_match_index = matched
        .as_ref()
        .map_or(0, |candidate| candidate.match_index);
    let matches = if all_matches.is_empty() {
        matched.into_iter().collect::<Vec<_>>()
    } else {
        all_matches
    };
    LogSearchResult {
        session_id,
        query,
        direction,
        case_sensitive,
        use_regex,
        whole_word,
        start_line,
        scanned_lines,
        total_lines,
        total_matches,
        active_match_index,
        duration_ms: started_at.elapsed().as_millis(),
        truncated: false,
        wrapped,
        matches: matches
            .into_iter()
            .map(|candidate| LogSearchMatch {
                line_number: candidate.line_number,
                start_column: candidate.start_column,
                end_column: candidate.end_column,
                line_preview: candidate.line_preview,
            })
            .collect(),
    }
}

fn preview_line(line: &str) -> String {
    const PREVIEW_CHARS: usize = 240;
    let mut preview = line.chars().take(PREVIEW_CHARS).collect::<String>();
    if line.chars().count() > PREVIEW_CHARS {
        preview.push_str("...");
    }
    preview
}

fn scan_log_markers(
    path: &PathBuf,
    file_size: u64,
) -> std::io::Result<(Vec<LogMarker>, HashMap<String, MarkerPayload>)> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut raw_line = Vec::new();
    let mut line_number = 0_usize;
    let mut byte_offset = 0_u64;
    let mut next_marker_index = 1_usize;
    let mut open_marker: Option<OpenMarker> = None;
    let mut open_stack: Option<OpenTextBlock> = None;
    let mut open_change_state: Option<OpenTextBlock> = None;
    let mut markers = Vec::new();
    let mut payloads = HashMap::new();

    loop {
        raw_line.clear();
        let read_count = reader.read_until(b'\n', &mut raw_line)?;
        if read_count == 0 {
            break;
        }

        line_number += 1;
        let line_start_byte = byte_offset;
        let line_end_byte = line_start_byte + read_count as u64;
        byte_offset = line_end_byte;
        let line_text = decode_log_line(&raw_line);
        let timestamp_content = split_timestamped_line(&line_text);

        if let Some(current) = open_stack.take() {
            if timestamp_content.is_some() || parse_message_header(&line_text).is_some() {
                close_text_marker(
                    current,
                    line_number.saturating_sub(1),
                    line_start_byte,
                    &mut markers,
                    &mut payloads,
                );
            } else {
                let mut current = current;
                current.lines.push(line_text);
                open_stack = Some(current);
                continue;
            }
        }

        if let Some(current) = open_change_state.take() {
            let done = line_text.trim() == "}";
            let mut current = current;
            current.lines.push(line_text);
            if done {
                close_text_marker(
                    current,
                    line_number,
                    line_end_byte,
                    &mut markers,
                    &mut payloads,
                );
            } else {
                open_change_state = Some(current);
            }
            continue;
        }

        if let Some(header) = parse_message_header(&line_text) {
            if let Some(current) = open_marker.take() {
                close_message_marker(
                    current,
                    line_number.saturating_sub(1),
                    line_start_byte,
                    &mut markers,
                    &mut payloads,
                );
            }

            let marker_id = format!("message-{next_marker_index}");
            next_marker_index += 1;
            open_marker = Some(OpenMarker {
                header,
                id: marker_id,
                start_line: line_number,
                start_byte: line_start_byte,
                body_lines: Vec::new(),
            });
            continue;
        }

        if is_message_separator(&line_text) {
            if let Some(current) = open_marker.take() {
                close_message_marker(
                    current,
                    line_number,
                    line_end_byte,
                    &mut markers,
                    &mut payloads,
                );
                continue;
            }
        }

        if let Some(current) = open_marker.as_mut() {
            current.body_lines.push(line_text);
            continue;
        }

        if line_text.trim() == "stack traceback:" {
            let marker_id = format!("stack-{next_marker_index}");
            next_marker_index += 1;
            open_stack = Some(OpenTextBlock {
                id: marker_id,
                kind: "error_stack".to_string(),
                title: "stack traceback".to_string(),
                color: "#f46d75".to_string(),
                line_time: String::new(),
                start_line: line_number,
                start_byte: line_start_byte,
                lines: vec![line_text],
            });
            continue;
        }

        if let Some((line_time, content)) = timestamp_content {
            if let Some(value) = parse_timestamped_json(content) {
                let marker_id = format!("json-{next_marker_index}");
                next_marker_index += 1;
                let title = value
                    .get("event_name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("JSON event")
                    .to_string();
                push_json_marker(
                    marker_id,
                    "json_event",
                    title,
                    "#b693ff",
                    line_number,
                    line_start_byte,
                    line_end_byte,
                    line_time,
                    content.to_string(),
                    value,
                    &mut markers,
                    &mut payloads,
                );
                continue;
            }

            if content.starts_with("ChangeState") {
                let marker_id = format!("state-{next_marker_index}");
                next_marker_index += 1;
                if content.contains('{') && !content.trim_end().ends_with('}') {
                    open_change_state = Some(OpenTextBlock {
                        id: marker_id,
                        kind: "state_change".to_string(),
                        title: content.trim_end_matches('{').trim().to_string(),
                        color: "#f0c84b".to_string(),
                        line_time: line_time.to_string(),
                        start_line: line_number,
                        start_byte: line_start_byte,
                        lines: vec![content.to_string()],
                    });
                } else {
                    push_raw_marker(
                        marker_id,
                        "state_change",
                        content.to_string(),
                        "#f0c84b",
                        line_number,
                        line_number,
                        line_start_byte,
                        line_end_byte,
                        line_time,
                        content.to_string(),
                        &mut markers,
                        &mut payloads,
                    );
                }
                continue;
            }

            if let Some((kind, title, color)) = keyword_marker(content) {
                let marker_id = format!("keyword-{next_marker_index}");
                next_marker_index += 1;
                push_raw_marker(
                    marker_id,
                    kind,
                    title,
                    color,
                    line_number,
                    line_number,
                    line_start_byte,
                    line_end_byte,
                    line_time,
                    content.to_string(),
                    &mut markers,
                    &mut payloads,
                );
            }
        }
    }

    if let Some(current) = open_marker.take() {
        close_message_marker(current, line_number, file_size, &mut markers, &mut payloads);
    }
    if let Some(current) = open_stack.take() {
        close_text_marker(current, line_number, file_size, &mut markers, &mut payloads);
    }
    if let Some(current) = open_change_state.take() {
        close_text_marker(current, line_number, file_size, &mut markers, &mut payloads);
    }

    apply_message_lanes(&mut markers);

    Ok((markers, payloads))
}

fn close_message_marker(
    marker: OpenMarker,
    end_line: usize,
    end_byte: u64,
    markers: &mut Vec<LogMarker>,
    payloads: &mut HashMap<String, MarkerPayload>,
) {
    let raw_text = trim_body_lines(&marker.body_lines);
    let (parse_status, parsed_json, parse_error) = try_parse_json_lenient(&raw_text);
    let color = color_for_message_id(marker.header.message_id);

    payloads.insert(
        marker.id.clone(),
        MarkerPayload {
            marker_id: marker.id.clone(),
            raw_text,
            parse_status: parse_status.clone(),
            parsed_json,
            parse_error,
        },
    );

    markers.push(LogMarker {
        id: marker.id,
        kind: "message".to_string(),
        title: format!(
            "[{}] {}",
            marker.header.message_id, marker.header.message_name
        ),
        color: color.to_string(),
        start_line: marker.start_line,
        end_line,
        start_byte: marker.start_byte,
        end_byte,
        line_time: marker.header.line_time,
        direction: marker.header.direction,
        message_id: marker.header.message_id,
        message_name: marker.header.message_name,
        lane_ratio: 0.0,
        parse_status,
    });
}

fn close_text_marker(
    marker: OpenTextBlock,
    end_line: usize,
    end_byte: u64,
    markers: &mut Vec<LogMarker>,
    payloads: &mut HashMap<String, MarkerPayload>,
) {
    let raw_text = trim_body_lines(&marker.lines);
    let (parse_status, parsed_json, parse_error) = try_parse_json_lenient(&raw_text);

    payloads.insert(
        marker.id.clone(),
        MarkerPayload {
            marker_id: marker.id.clone(),
            raw_text,
            parse_status: parse_status.clone(),
            parsed_json,
            parse_error,
        },
    );

    markers.push(LogMarker {
        id: marker.id,
        kind: marker.kind,
        title: marker.title,
        color: marker.color,
        start_line: marker.start_line,
        end_line,
        start_byte: marker.start_byte,
        end_byte,
        line_time: marker.line_time,
        direction: String::new(),
        message_id: 0,
        message_name: String::new(),
        lane_ratio: 0.5,
        parse_status,
    });
}

fn push_json_marker(
    marker_id: String,
    kind: &str,
    title: String,
    color: &str,
    line_number: usize,
    start_byte: u64,
    end_byte: u64,
    line_time: &str,
    raw_text: String,
    parsed_json: serde_json::Value,
    markers: &mut Vec<LogMarker>,
    payloads: &mut HashMap<String, MarkerPayload>,
) {
    payloads.insert(
        marker_id.clone(),
        MarkerPayload {
            marker_id: marker_id.clone(),
            raw_text,
            parse_status: "ok".to_string(),
            parsed_json: Some(parsed_json),
            parse_error: None,
        },
    );

    markers.push(LogMarker {
        id: marker_id,
        kind: kind.to_string(),
        title,
        color: color.to_string(),
        start_line: line_number,
        end_line: line_number,
        start_byte,
        end_byte,
        line_time: line_time.to_string(),
        direction: String::new(),
        message_id: 0,
        message_name: String::new(),
        lane_ratio: 0.5,
        parse_status: "ok".to_string(),
    });
}

fn push_raw_marker(
    marker_id: String,
    kind: &str,
    title: String,
    color: &str,
    start_line: usize,
    end_line: usize,
    start_byte: u64,
    end_byte: u64,
    line_time: &str,
    raw_text: String,
    markers: &mut Vec<LogMarker>,
    payloads: &mut HashMap<String, MarkerPayload>,
) {
    payloads.insert(
        marker_id.clone(),
        MarkerPayload {
            marker_id: marker_id.clone(),
            raw_text,
            parse_status: "raw".to_string(),
            parsed_json: None,
            parse_error: None,
        },
    );

    markers.push(LogMarker {
        id: marker_id,
        kind: kind.to_string(),
        title,
        color: color.to_string(),
        start_line,
        end_line,
        start_byte,
        end_byte,
        line_time: line_time.to_string(),
        direction: String::new(),
        message_id: 0,
        message_name: String::new(),
        lane_ratio: 0.5,
        parse_status: "raw".to_string(),
    });
}

fn parse_message_header(line: &str) -> Option<MessageHeader> {
    let (line_time, content) = line.split_once('\t')?;
    if !is_hhmmss(line_time) {
        return None;
    }

    let content = content.trim();
    let content = content.trim_matches('=').trim();
    let (direction, rest) = if let Some(rest) = content.strip_prefix("Receive Message ([") {
        ("Receive", rest)
    } else if let Some(rest) = content.strip_prefix("Send Message ([") {
        ("Send", rest)
    } else {
        return None;
    };
    let (message_id, rest) = rest.split_once(']')?;
    let message_id = message_id.parse::<u64>().ok()?;
    let rest = rest.trim_start();
    let (message_name, _) = rest.split_once(')')?;
    let message_name = message_name.trim();
    if message_name.is_empty() {
        return None;
    }

    Some(MessageHeader {
        line_time: line_time.to_string(),
        direction: direction.to_string(),
        message_id,
        message_name: message_name.to_string(),
    })
}

fn split_timestamped_line(line: &str) -> Option<(&str, &str)> {
    let (line_time, content) = line.split_once('\t')?;
    if is_hhmmss(line_time) {
        Some((line_time, content))
    } else {
        None
    }
}

fn parse_timestamped_json(content: &str) -> Option<serde_json::Value> {
    let trimmed = content.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }
    serde_json::from_str(trimmed)
        .ok()
        .or_else(|| try_lenient_json_parse(trimmed))
}

/// Try strict JSON parse first, then fall back to lenient approaches that
/// mirror the Python LogReceiver.py logic:
/// 1. Strip illegal control characters (U+0000..U+001F except \t, \n, \r)
/// 2. Remove outer quotes from nested JSON fields ("key": "{...}" → "key": {...})
/// 3. Fallback: wrap in [...] and parse as array
fn try_parse_json_lenient(raw: &str) -> (String, Option<serde_json::Value>, Option<String>) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return ("raw".to_string(), None, None);
    }

    // Step 1: strict parse
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return ("ok".to_string(), Some(value), None);
    }

    // Step 2: lenient pipeline (control chars → outer-quote removal → array wrap)
    if let Some(value) = try_lenient_json_parse(trimmed) {
        return ("ok".to_string(), Some(value), None);
    }

    let err = serde_json::from_str::<serde_json::Value>(trimmed)
        .err()
        .map(|e| e.to_string());
    ("raw".to_string(), None, err)
}

/// Multi-stage lenient JSON parse following LogReceiver.py strategy:
/// 1. Strip illegal control characters and retry
/// 2. Remove outer quotes for nested JSON fields and retry
/// 3. Wrap in [...] and retry (handles malformed concatenated JSON)
fn try_lenient_json_parse(raw: &str) -> Option<serde_json::Value> {
    // Stage 1: strip control characters
    let cleaned = strip_json_control_chars(raw);
    let s1 = cleaned.as_deref().unwrap_or(raw);
    if cleaned.is_some() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(s1) {
            return Some(value);
        }
    }

    // Stage 2: remove outer quotes from nested JSON fields
    // e.g. "fieldName": "{\"a\":1}" → "fieldName": {"a":1}
    let unquoted = remove_outer_quotes_for_json_fields(s1);
    if let Some(ref uq) = unquoted {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(uq) {
            return Some(value);
        }
    }

    // Stage 3: wrap in [] and try parsing as array
    let s2 = unquoted.as_deref().unwrap_or(s1);
    let wrapped = format!("[{}]", s2);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&wrapped) {
        return Some(value);
    }

    None
}

/// Escape control characters (U+0000..U+001F) that appear **inside JSON
/// string values** as `\uXXXX`.  Structural whitespace outside strings
/// (newlines, tabs between keys) is left untouched so the JSON structure
/// stays valid.  Uses a lightweight state machine to track in-string state.
/// Returns None if nothing was changed.
fn strip_json_control_chars(raw: &str) -> Option<String> {
    use std::fmt::Write;
    let mut cleaned = String::with_capacity(raw.len());
    let mut changed = false;
    let mut in_string = false;
    let mut escape_next = false;

    for ch in raw.chars() {
        if escape_next {
            // Previous char was `\` inside a string — emit as-is
            cleaned.push(ch);
            escape_next = false;
            continue;
        }

        if in_string {
            if ch == '\\' {
                escape_next = true;
                cleaned.push(ch);
            } else if ch == '"' {
                in_string = false;
                cleaned.push(ch);
            } else if ch.is_control() {
                // Control char inside a string value — escape it
                let _ = write!(cleaned, "\\u{:04x}", ch as u32);
                changed = true;
            } else {
                cleaned.push(ch);
            }
        } else {
            // Outside a string — only toggle on unescaped `"`
            if ch == '"' {
                in_string = true;
            }
            cleaned.push(ch);
        }
    }

    if changed { Some(cleaned) } else { None }
}


/// Port of Python remove_outer_quotes_for_json_fields():
/// Match `"key": "{...}"` patterns and strip the outer quotes wrapping the
/// nested JSON object, turning it into `"key": {...}`.
/// Returns None if nothing was changed.
fn remove_outer_quotes_for_json_fields(raw: &str) -> Option<String> {
    use regex::Regex;
    use std::sync::OnceLock;

    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        // Match:  "someKey" : "{ ... }"
        // Group 1: the prefix  "someKey" :
        // Group 2: the inner JSON object text including braces
        Regex::new(r#"("[\w]+")\s*:\s*"(\{.*?\})""#).unwrap()
    });

    let result = re.replace_all(raw, |caps: &regex::Captures| {
        format!("{}: {}", &caps[1], &caps[2])
    });

    if result.as_ref() == raw {
        None
    } else {
        Some(result.into_owned())
    }
}

fn keyword_marker(content: &str) -> Option<(&'static str, String, &'static str)> {
    let lower = content.to_ascii_lowercase();
    if lower.contains("error")
        || lower.contains("failed")
        || lower.contains("not found")
        || lower.contains("exception")
    {
        return Some(("keyword", content.to_string(), "#f46d75"));
    }
    if lower.contains("warn") || lower.contains("corrupt") || lower.contains("currupted") {
        return Some(("keyword", content.to_string(), "#f0c84b"));
    }
    None
}

fn color_for_message_id(message_id: u64) -> String {
    let mut value = message_id.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    value ^= value >> 33;
    value = value.wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    let hue = value % 360;
    format!("hsl({hue}, 72%, 58%)")
}

fn apply_message_lanes(markers: &mut [LogMarker]) {
    let max_message_id = markers
        .iter()
        .filter(|marker| marker.kind == "message")
        .map(|marker| marker.message_id)
        .max()
        .unwrap_or(0);
    if max_message_id == 0 {
        return;
    }

    for marker in markers.iter_mut().filter(|marker| marker.kind == "message") {
        marker.lane_ratio = (marker.message_id as f64 / max_message_id as f64).clamp(0.0, 1.0);
    }
}

fn is_hhmmss(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 8
        && bytes[2] == b':'
        && bytes[5] == b':'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 2 || index == 5 || byte.is_ascii_digit())
}

fn is_message_separator(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.len() >= 12 && trimmed.bytes().all(|byte| byte == b'=')
}

fn decode_log_line(raw_line: &[u8]) -> String {
    let line = raw_line.strip_suffix(b"\n").unwrap_or(raw_line);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    String::from_utf8_lossy(line).into_owned()
}

fn trim_body_lines(lines: &[String]) -> String {
    let mut start = 0;
    let mut end = lines.len();
    while start < end && lines[start].trim().is_empty() {
        start += 1;
    }
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    lines[start..end].join("\n")
}

fn build_line_index(file: File, file_size: u64) -> std::io::Result<(Vec<u64>, bool)> {
    if file_size == 0 {
        return Ok((Vec::new(), false));
    }

    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut line_offsets = vec![0];
    let mut absolute_offset = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];
    let mut ended_with_newline = false;

    loop {
        let read_count = reader.read(&mut buffer)?;
        if read_count == 0 {
            break;
        }

        ended_with_newline = buffer[read_count - 1] == b'\n';

        for (index, byte) in buffer[..read_count].iter().enumerate() {
            if *byte == b'\n' {
                let next_offset = absolute_offset + index as u64 + 1;
                if next_offset < file_size {
                    line_offsets.push(next_offset);
                }
            }
        }

        absolute_offset += read_count as u64;
    }

    Ok((line_offsets, ended_with_newline))
}

fn split_lines(buffer: &[u8]) -> Vec<String> {
    let mut chunks = buffer.split(|byte| *byte == b'\n').collect::<Vec<_>>();
    if matches!(chunks.last(), Some(last) if last.is_empty()) {
        chunks.pop();
    }

    chunks
        .into_iter()
        .map(|line| {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            String::from_utf8_lossy(line).into_owned()
        })
        .collect()
}

fn normalize_fixture_profile(profile: Option<String>) -> String {
    match profile
        .unwrap_or_else(|| "mixed".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "short-lines" | "short_lines" => "short-lines".to_string(),
        "long-lines" | "long_lines" => "long-lines".to_string(),
        "dense-markers" | "dense_markers" => "dense-markers".to_string(),
        "append-stream" | "append_stream" => "append-stream".to_string(),
        _ => "mixed".to_string(),
    }
}

fn generate_fixture(size_mb: u64, profile: &str) -> std::io::Result<FixtureMetadata> {
    let target_bytes = size_mb * 1024 * 1024;
    let fixture_dir = std::env::temp_dir().join("log_scope").join("fixtures");
    fs::create_dir_all(&fixture_dir)?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let safe_profile = safe_socket_filename_part(profile);
    let path = fixture_dir.join(format!(
        "logscope-fixture-{safe_profile}-{size_mb}mb-{suffix}.log"
    ));

    let started_at = Instant::now();
    let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, File::create(&path)?);
    let mut written = 0_u64;
    let mut line_count = 0_usize;

    while written < target_bytes {
        line_count += 1;
        let line = fixture_line(profile, line_count);
        writer.write_all(line.as_bytes())?;
        written += line.len() as u64;
    }

    writer.flush()?;
    let file_size = fs::metadata(&path)?.len();

    Ok(FixtureMetadata {
        path: path.to_string_lossy().into_owned(),
        file_size,
        line_count,
        profile: profile.to_string(),
        generation_duration_ms: started_at.elapsed().as_millis(),
    })
}

fn fixture_line(profile: &str, line_count: usize) -> String {
    match profile {
        "short-lines" => {
            let severity = match line_count % 7 {
                0 => "ERROR",
                1 | 2 => "WARN",
                _ => "INFO",
            };
            format!(
                "{:02}:{:02}:{:02}\t{severity} id={} v={}\n",
                (line_count / 3600) % 24,
                (line_count / 60) % 60,
                line_count % 60,
                line_count,
                line_count % 997
            )
        }
        "long-lines" => {
            let repeated = " payload_key=value trace_segment=abcdefghijklmnopqrstuvwxyz0123456789".repeat(64);
            format!(
                "2026-04-25T12:{:02}:{:02}.{:03}Z INFO worker={} request_id=req-{:08} long_line=true{repeated}\n",
                (line_count / 60) % 60,
                line_count % 60,
                line_count % 1000,
                line_count % 16,
                line_count,
            )
        }
        "dense-markers" if line_count % 3 == 0 => format!(
            "13:{:02}:{:02}\t{{\"event_name\":\"fixture_marker\",\"line\":{},\"severity\":\"{}\",\"payload\":{{\"value\":{}}}}}\n",
            (line_count / 60) % 60,
            line_count % 60,
            line_count,
            if line_count % 12 == 0 { "error" } else { "info" },
            line_count % 997
        ),
        "append-stream" => format!(
            "13:{:02}:{:02}\t{} append fixture stream_id={} batch={} message=\"tail pressure sample\"\n",
            (line_count / 60) % 60,
            line_count % 60,
            if line_count % 11 == 0 { "WARN" } else { "INFO" },
            line_count % 32,
            line_count / 128,
        ),
        _ => {
            let severity = match line_count % 5 {
                0 => "ERROR",
                1 | 2 => "INFO",
                _ => "WARN",
            };
            format!(
                "2026-04-25T12:{:02}:{:02}.{:03}Z {severity} worker={} request_id=req-{:08} stage=fixture message=\"synthetic log row for virtualization and indexing validation\" value={}\n",
                (line_count / 60) % 60,
                line_count % 60,
                line_count % 1000,
                line_count % 16,
                line_count,
                line_count % 997
            )
        }
    }
}

fn run_core_benchmark_sync(size_mb: u64, profile: &str) -> std::io::Result<CoreBenchmarkReport> {
    let fixture = generate_fixture(size_mb, profile)?;
    let session = LogSession::open(PathBuf::from(&fixture.path))?;

    let search = search_text_snapshot(
        1,
        session.search_snapshot(),
        "error".to_string(),
        1,
        0,
        "next".to_string(),
        false,
        false,
        false,
        true,
        true,
    )?;

    let read_started_at = Instant::now();
    let visible = session.read_lines(1, 1, 240)?;
    let read_visible_duration_ms = read_started_at.elapsed().as_millis();

    Ok(CoreBenchmarkReport {
        fixture,
        index_duration_ms: session.index_duration_ms,
        marker_count: session.markers.len(),
        search_duration_ms: search.duration_ms,
        search_total_matches: search.total_matches,
        read_visible_duration_ms,
        read_visible_line_count: visible.lines.len(),
    })
}

fn read_socket_frames_to_file(mut stream: TcpStream, path: PathBuf) -> std::io::Result<()> {
    const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

    let file = File::options().append(true).open(path)?;
    let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, file);

    loop {
        let mut length_bytes = [0_u8; 4];
        stream.read_exact(&mut length_bytes)?;
        let frame_len = u32::from_be_bytes(length_bytes) as usize;
        if frame_len == 0 || frame_len > MAX_FRAME_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid socket frame length: {frame_len}"),
            ));
        }

        let mut payload = vec![0_u8; frame_len];
        stream.read_exact(&mut payload)?;
        let frame: SocketFrame = serde_json::from_slice(&payload).map_err(|err| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid socket frame json: {err}"),
            )
        })?;

        if frame.version != 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unsupported socket protocol version: {}", frame.version),
            ));
        }

        match frame.record_type.as_str() {
            "log.batch" => {
                if let Some(records) = frame.records {
                    for record in records {
                        write_socket_text_record(&mut writer, &record.text)?;
                    }
                }
            }
            "log.text" => {
                if let Some(payload) = frame.payload {
                    write_socket_text_record(&mut writer, &payload)?;
                }
            }
            other => {
                write_socket_text_record(
                    &mut writer,
                    &format!(
                        "00:00:00\tWARN unsupported socket record_type={other} in logscope-frame-v1"
                    ),
                )?;
            }
        }

        writer.flush()?;
    }
}

fn safe_socket_filename_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn write_socket_text_record<W: Write>(writer: &mut W, text: &str) -> std::io::Result<()> {
    writer.write_all(text.as_bytes())?;
    if !text.ends_with('\n') {
        writer.write_all(b"\n")?;
    }
    Ok(())
}

impl Default for PersistedStore {
    fn default() -> Self {
        Self {
            schema_version: 1,
            recent_files: Vec::new(),
            recent_sockets: Vec::new(),
            last_source: None,
            ui_state: PersistedUiState::default(),
        }
    }
}

impl Default for PersistedUiState {
    fn default() -> Self {
        Self {
            follow_tail: true,
            show_global_minimap: true,
            show_local_minimap: true,
            log_color_mode: "full".to_string(),
            search_query: String::new(),
            search_case_sensitive: false,
            search_regex: false,
            search_whole_word: false,
            search_wrap_around: true,
            search_find_all: true,
        }
    }
}

fn load_persisted_store(app: &tauri::AppHandle) -> std::io::Result<PersistedStore> {
    let path = persisted_store_path(app)?;
    if !path.exists() {
        return Ok(PersistedStore::default());
    }

    let bytes = fs::read(path)?;
    let store = serde_json::from_slice::<PersistedStore>(&bytes).unwrap_or_default();
    Ok(sanitize_store(store))
}

fn save_persisted_store(app: &tauri::AppHandle, store: &PersistedStore) -> std::io::Result<()> {
    let path = persisted_store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(&sanitize_store(store.clone())).map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("failed to encode persisted state: {err}"),
        )
    })?;
    fs::write(path, bytes)
}

fn persisted_store_path(app: &tauri::AppHandle) -> std::io::Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("failed to resolve app data dir: {err}"),
        )
    })?;
    Ok(dir.join("state-v1.json"))
}

fn remember_recent_file(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let mut store = load_persisted_store(app).map_err(|err| err.to_string())?;
    let now = unix_timestamp_seconds();
    store.recent_files.retain(|source| source.path != path);
    store.recent_files.insert(
        0,
        PersistedFileSource {
            display_name: display_name_for_path(&path),
            path: path.clone(),
            last_opened_at: now,
        },
    );
    store.recent_files.truncate(12);
    store.last_source = Some(PersistedDataSource {
        kind: "file".to_string(),
        path: Some(path),
        host: None,
        port: None,
    });
    let result = save_persisted_store(app, &store).map_err(|err| err.to_string());
    deferred_update_app_menu(app);
    result
}

fn remember_recent_socket(app: &tauri::AppHandle, host: String, port: u16) -> Result<(), String> {
    let mut store = load_persisted_store(app).map_err(|err| err.to_string())?;
    let now = unix_timestamp_seconds();
    store
        .recent_sockets
        .retain(|source| source.host != host || source.port != port);
    store.recent_sockets.insert(
        0,
        PersistedSocketSource {
            display_name: format!("{host}:{port}"),
            host: host.clone(),
            port,
            last_opened_at: now,
        },
    );
    store.recent_sockets.truncate(12);
    store.last_source = Some(PersistedDataSource {
        kind: "socket".to_string(),
        path: None,
        host: Some(host),
        port: Some(port),
    });
    let result = save_persisted_store(app, &store).map_err(|err| err.to_string());
    deferred_update_app_menu(app);
    result
}

fn sanitize_store(mut store: PersistedStore) -> PersistedStore {
    store.schema_version = 1;
    store
        .recent_files
        .retain(|source| !source.path.trim().is_empty());
    store
        .recent_sockets
        .retain(|source| !source.host.trim().is_empty() && source.port > 0);
    store.recent_files.truncate(12);
    store.recent_sockets.truncate(12);
    store.ui_state = sanitize_ui_state(store.ui_state);
    store
}

fn sanitize_ui_state(mut ui_state: PersistedUiState) -> PersistedUiState {
    if !matches!(
        ui_state.log_color_mode.as_str(),
        "full" | "severity" | "off"
    ) {
        ui_state.log_color_mode = "full".to_string();
    }
    ui_state.search_query = ui_state.search_query.chars().take(256).collect();
    ui_state
}

fn display_name_for_path(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn unix_timestamp_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn deferred_update_app_menu(app_handle: &tauri::AppHandle) {
    let app_clone = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let app_clone2 = app_clone.clone();
        let _ = app_clone.run_on_main_thread(move || {
            let _ = update_app_menu(&app_clone2);
        });
    });
}

pub fn update_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    let mut file_items = Vec::new();
    let mut socket_items = Vec::new();
    let mut separator1 = None;
    let mut separator2 = None;
    let mut clear_item = None;

    if let Ok(store) = load_persisted_store(app_handle) {
        let has_files = !store.recent_files.is_empty();
        let has_sockets = !store.recent_sockets.is_empty();
        
        for file in store.recent_files {
            let item = MenuItem::with_id(app_handle, format!("open_recent_file_{}", file.path), file.display_name, true, None::<&str>)?;
            file_items.push(item);
        }
        
        if has_files && has_sockets {
            separator1 = Some(PredefinedMenuItem::separator(app_handle)?);
        }
        
        for socket in store.recent_sockets {
            let id_host_port = format!("{}:{}", socket.host, socket.port);
            let item = MenuItem::with_id(app_handle, format!("open_recent_socket_{id_host_port}"), socket.display_name, true, None::<&str>)?;
            socket_items.push(item);
        }
        
        if has_files || has_sockets {
            separator2 = Some(PredefinedMenuItem::separator(app_handle)?);
        }
    }

    clear_item = Some(MenuItem::with_id(app_handle, "clear_all_recent", "Clear All", true, None::<&str>)?);

    let mut recent_items_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    for item in &file_items {
        recent_items_refs.push(item);
    }
    if let Some(sep) = &separator1 {
        recent_items_refs.push(sep);
    }
    for item in &socket_items {
        recent_items_refs.push(item);
    }
    if let Some(sep) = &separator2 {
        recent_items_refs.push(sep);
    }
    if let Some(clear) = &clear_item {
        recent_items_refs.push(clear);
    }

    let open_recent_submenu = Submenu::with_items(
        app_handle,
        "Open Recent",
        true,
        &recent_items_refs,
    )?;

    let open_file_item = MenuItem::with_id(app_handle, "open_file", "Open...", true, Some("CmdOrCtrl+O"))?;
    let connect_socket_item = MenuItem::with_id(app_handle, "connect_socket", "Connect Socket", true, Some("CmdOrCtrl+Shift+O"))?;

    let file_submenu = Submenu::with_items(
        app_handle,
        "File",
        true,
        &[
            &open_file_item,
            &connect_socket_item,
            &open_recent_submenu,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::quit(app_handle, None)?,
        ],
    )?;

    let fixture_mixed = MenuItem::with_id(app_handle, "gen_fixture_mixed", "Mixed", true, None::<&str>)?;
    let fixture_short = MenuItem::with_id(app_handle, "gen_fixture_short-lines", "短行 (Short Lines)", true, None::<&str>)?;
    let fixture_long = MenuItem::with_id(app_handle, "gen_fixture_long-lines", "超长行 (Long Lines)", true, None::<&str>)?;
    let fixture_dense = MenuItem::with_id(app_handle, "gen_fixture_dense-markers", "高密度 Marker (Dense Markers)", true, None::<&str>)?;
    let fixture_append = MenuItem::with_id(app_handle, "gen_fixture_append-stream", "Append", true, None::<&str>)?;
    let fixture_submenu = Submenu::with_items(app_handle, "Generate 50MB Fixture", true, &[&fixture_mixed, &fixture_short, &fixture_long, &fixture_dense, &fixture_append])?;

    let bench_mixed = MenuItem::with_id(app_handle, "benchmark_mixed", "Mixed", true, None::<&str>)?;
    let bench_short = MenuItem::with_id(app_handle, "benchmark_short-lines", "短行 (Short Lines)", true, None::<&str>)?;
    let bench_long = MenuItem::with_id(app_handle, "benchmark_long-lines", "超长行 (Long Lines)", true, None::<&str>)?;
    let bench_dense = MenuItem::with_id(app_handle, "benchmark_dense-markers", "高密度 Marker (Dense Markers)", true, None::<&str>)?;
    let bench_append = MenuItem::with_id(app_handle, "benchmark_append-stream", "Append", true, None::<&str>)?;
    let bench_submenu = Submenu::with_items(app_handle, "Core Benchmark", true, &[&bench_mixed, &bench_short, &bench_long, &bench_dense, &bench_append])?;

    let health_check_item = MenuItem::with_id(app_handle, "health_check", "Command 自检", true, None::<&str>)?;

    let debug_submenu = Submenu::with_items(app_handle, "Debug", true, &[&fixture_submenu, &bench_submenu, &health_check_item])?;

    let edit_submenu = Submenu::with_items(
        app_handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app_handle, None)?,
            &PredefinedMenuItem::redo(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::cut(app_handle, None)?,
            &PredefinedMenuItem::copy(app_handle, None)?,
            &PredefinedMenuItem::paste(app_handle, None)?,
            &PredefinedMenuItem::select_all(app_handle, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app_handle,
            "log_scope",
            true,
            &[
                &PredefinedMenuItem::about(app_handle, None, None)?,
                &PredefinedMenuItem::separator(app_handle)?,
                &PredefinedMenuItem::services(app_handle, None)?,
                &PredefinedMenuItem::separator(app_handle)?,
                &PredefinedMenuItem::hide(app_handle, None)?,
                &PredefinedMenuItem::hide_others(app_handle, None)?,
                &PredefinedMenuItem::show_all(app_handle, None)?,
                &PredefinedMenuItem::separator(app_handle)?,
                &PredefinedMenuItem::quit(app_handle, None)?,
            ],
        )?;
        let menu = Menu::with_items(app_handle, &[&app_menu, &file_submenu, &edit_submenu, &debug_submenu])?;
        app_handle.set_menu(menu)?;
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        let menu = Menu::with_items(app_handle, &[&file_submenu, &edit_submenu, &debug_submenu])?;
        app_handle.set_menu(menu)?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle();
            let _ = update_app_menu(app_handle);
            

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if id == "open_file" || id == "connect_socket" || id == "health_check" {
                    let _ = app_handle.emit(
                        "menu-event",
                        serde_json::json!({ "action": id }),
                    );
                } else if let Some(path) = id.strip_prefix("open_recent_file_") {
                    let _ = app_handle.emit(
                        "menu-event",
                        serde_json::json!({ "action": "open_recent_file", "path": path }),
                    );
                } else if id == "clear_all_recent" {
                    let mut store = load_persisted_store(app_handle).unwrap_or_else(|_| PersistedStore {
                        schema_version: 1,
                        recent_files: Vec::new(),
                        recent_sockets: Vec::new(),
                        last_source: None,
                        ui_state: sanitize_ui_state(PersistedUiState {
                            follow_tail: true,
                            show_global_minimap: true,
                            show_local_minimap: true,
                            log_color_mode: "full".to_string(),
                            search_query: "".to_string(),
                            search_case_sensitive: false,
                            search_regex: false,
                            search_whole_word: false,
                            search_wrap_around: true,
                            search_find_all: true,
                        }),
                    });
                    store.recent_files.clear();
                    store.recent_sockets.clear();
                    let _ = save_persisted_store(app_handle, &store);
                    deferred_update_app_menu(app_handle);
                } else if let Some(path) = id.strip_prefix("clear_recent_file_") {
                    let _ = remove_recent_file(path.to_string(), app_handle.clone());
                    deferred_update_app_menu(app_handle);
                } else if let Some(host_port) = id.strip_prefix("open_recent_socket_") {
                    if let Some((host, port)) = host_port.rsplit_once(':') {
                        if let Ok(port) = port.parse::<u16>() {
                            let _ = app_handle.emit(
                                "menu-event",
                                serde_json::json!({ "action": "open_recent_socket", "host": host, "port": port }),
                            );
                        }
                    }
                } else if let Some(host_port) = id.strip_prefix("clear_recent_socket_") {
                    if let Some((host, port)) = host_port.rsplit_once(':') {
                        if let Ok(port) = port.parse::<u16>() {
                            let _ = remove_recent_socket(host.to_string(), port, app_handle.clone());
                            deferred_update_app_menu(app_handle);
                        }
                    }
                } else if let Some(profile) = id.strip_prefix("gen_fixture_") {
                    let _ = app_handle.emit(
                        "menu-event",
                        serde_json::json!({ "action": "gen_fixture", "profile": profile }),
                    );
                } else if let Some(profile) = id.strip_prefix("benchmark_") {
                    let _ = app_handle.emit(
                        "menu-event",
                        serde_json::json!({ "action": "benchmark", "profile": profile }),
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            open_file_placeholder,
            open_log_file,
            generate_log_fixture,
            run_core_benchmark,
            connect_log_socket,
            get_persisted_state,
            save_ui_state,
            remove_recent_file,
            remove_recent_socket,
            get_log_lines,
            get_log_markers,
            get_marker_payload,
            refresh_log_file,
            search_log_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running log_scope");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn builds_offsets_for_lf_and_crlf_lines() {
        let path = test_file_path("line-index.log");
        fs::write(&path, b"one\r\ntwo\nthree").unwrap();

        let session = LogSession::open(path.clone()).unwrap();

        assert_eq!(session.line_offsets, vec![0, 5, 9]);
        assert_eq!(session.file_size, 14);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_only_requested_line_range() {
        let path = test_file_path("line-range.log");
        fs::write(&path, b"alpha\nbeta\ngamma\ndelta\n").unwrap();
        let session = LogSession::open(path.clone()).unwrap();

        let range = session.read_lines(7, 2, 2).unwrap();

        assert_eq!(range.session_id, 7);
        assert_eq!(range.start_line, 2);
        assert_eq!(range.total_lines, 4);
        assert_eq!(
            range
                .lines
                .iter()
                .map(|line| (line.line_number, line.text.as_str()))
                .collect::<Vec<_>>(),
            vec![(2, "beta"), (3, "gamma")]
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn treats_empty_file_as_zero_lines() {
        let path = test_file_path("empty.log");
        File::create(&path).unwrap();

        let session = LogSession::open(path.clone()).unwrap();

        assert!(session.line_offsets.is_empty());
        assert_eq!(session.read_lines(1, 1, 20).unwrap().line_count, 0);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn refresh_indexes_appended_lines_without_rebuilding() {
        let path = test_file_path("append.log");
        fs::write(&path, b"one\n").unwrap();
        let mut session = LogSession::open(path.clone()).unwrap();

        append_bytes(&path, b"two\nthree").unwrap();
        let metadata = session.refresh(9).unwrap();
        let range = session.read_lines(9, 1, 10).unwrap();

        assert_eq!(metadata.session_id, 9);
        assert_eq!(metadata.appended_bytes, 9);
        assert_eq!(metadata.appended_lines, 2);
        assert!(!metadata.was_truncated);
        assert_eq!(
            range
                .lines
                .iter()
                .map(|line| (line.line_number, line.text.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "one"), (2, "two"), (3, "three")]
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn refresh_rebuilds_after_truncation() {
        let path = test_file_path("truncate.log");
        fs::write(&path, b"one\ntwo\nthree\n").unwrap();
        let mut session = LogSession::open(path.clone()).unwrap();

        fs::write(&path, b"fresh\n").unwrap();
        let metadata = session.refresh(3).unwrap();
        let range = session.read_lines(3, 1, 10).unwrap();

        assert!(metadata.was_truncated);
        assert_eq!(metadata.appended_bytes, 0);
        assert_eq!(metadata.line_count, 1);
        assert_eq!(range.lines[0].text, "fresh");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn extracts_send_and_receive_message_markers() {
        let path = test_file_path("messages.log");
        fs::write(
            &path,
            concat!(
                "13:05:41\t========= Send Message ([10] GETSERVER) [05:05:41] =========\n",
                "{\n",
                "    \"AppVersion\": 300\n",
                "}\n",
                "============================================\n",
                "\n",
                "13:05:42\tOpenUI\tUIShield\n",
                "13:05:42\t========= Receive Message ([43] S_LOGIN_RESULT) [05:05:42] =========\n",
                "\n",
                "13:05:42\tGOT LOGIN RESPOSE\t1\n",
            ),
        )
        .unwrap();

        let session = LogSession::open(path.clone()).unwrap();

        assert_eq!(session.markers.len(), 2);
        assert_eq!(session.markers[0].title, "[10] GETSERVER");
        assert_eq!(session.markers[0].direction, "Send");
        assert_eq!(session.markers[0].start_line, 1);
        assert_eq!(session.markers[0].end_line, 5);
        assert_eq!(session.markers[0].parse_status, "ok");
        assert_eq!(session.markers[1].title, "[43] S_LOGIN_RESULT");
        assert_eq!(session.markers[1].parse_status, "raw");

        let payload = session
            .marker_payloads
            .get(&session.markers[0].id)
            .expect("payload exists");
        assert_eq!(payload.parsed_json.as_ref().unwrap()["AppVersion"], 300);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn gives_same_message_id_stable_color_and_lane() {
        let path = test_file_path("message-lanes.log");
        fs::write(
            &path,
            concat!(
                "13:05:41\t========= Send Message ([42] LOGIN) [05:05:41] =========\n",
                "{}\n",
                "============================================\n",
                "13:05:42\t========= Receive Message ([84] PING) [05:05:42] =========\n",
                "{}\n",
                "============================================\n",
                "13:05:43\t========= Receive Message ([42] LOGIN) [05:05:43] =========\n",
                "{}\n",
                "============================================\n",
            ),
        )
        .unwrap();

        let session = LogSession::open(path.clone()).unwrap();
        let login_markers = session
            .markers
            .iter()
            .filter(|marker| marker.message_id == 42)
            .collect::<Vec<_>>();

        assert_eq!(login_markers.len(), 2);
        assert_eq!(login_markers[0].color, login_markers[1].color);
        assert_eq!(login_markers[0].lane_ratio, login_markers[1].lane_ratio);
        assert_eq!(login_markers[0].lane_ratio, 0.5);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn extracts_json_state_stack_and_keyword_markers() {
        let path = test_file_path("mixed-markers.log");
        fs::write(
            &path,
            concat!(
                "13:04:34\t{\"event_name\":\"c_p_010_launch_game\",\"value\":1}\n",
                "13:05:41\tChangeState\tInit\tframe\t1\t{\n",
                "    \"n\": 0\n",
                "}\n",
                "stack traceback:\n",
                "\tApplication.lua:28: in function <Application.lua:27>\n",
                "13:05:42\tSaves/SaveFunc.lua:6: FuncUnlock not found: 149\n",
            ),
        )
        .unwrap();

        let session = LogSession::open(path.clone()).unwrap();

        assert!(session
            .markers
            .iter()
            .any(|marker| marker.kind == "json_event" && marker.title == "c_p_010_launch_game"));
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.kind == "state_change"
                && marker.start_line == 2
                && marker.end_line == 4));
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.kind == "error_stack"
                && marker.start_line == 5
                && marker.end_line == 6));
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.kind == "keyword" && marker.start_line == 7));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn searches_forward_and_previous_with_wraparound() {
        let path = test_file_path("search.log");
        fs::write(
            &path,
            concat!(
                "alpha first\n",
                "beta target one\n",
                "gamma\n",
                "target two\n",
                "omega\n",
            ),
        )
        .unwrap();
        let session = LogSession::open(path.clone()).unwrap();

        let next = search_text_snapshot(
            4,
            session.search_snapshot(),
            "target".to_string(),
            3,
            0,
            "next".to_string(),
            false,
            false,
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(next.matches[next.active_match_index - 1].line_number, 4);
        assert_eq!(next.total_matches, 2);
        assert_eq!(next.active_match_index, 2);
        assert!(!next.wrapped);

        let previous = search_text_snapshot(
            4,
            session.search_snapshot(),
            "target".to_string(),
            3,
            0,
            "previous".to_string(),
            false,
            false,
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(
            previous.matches[previous.active_match_index - 1].line_number,
            2
        );
        assert_eq!(previous.total_matches, 2);
        assert_eq!(previous.active_match_index, 1);

        let wrapped_next = search_text_snapshot(
            4,
            session.search_snapshot(),
            "target".to_string(),
            4,
            1,
            "next".to_string(),
            false,
            false,
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(
            wrapped_next.matches[wrapped_next.active_match_index - 1].line_number,
            2
        );
        assert_eq!(wrapped_next.active_match_index, 1);
        assert!(wrapped_next.wrapped);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn searches_regex_and_whole_word_with_total_count() {
        let path = test_file_path("search-regex.log");
        fs::write(
            &path,
            concat!("error err error42\n", "WARN warning\n", "fatal exception\n",),
        )
        .unwrap();
        let session = LogSession::open(path.clone()).unwrap();

        let regex = search_text_snapshot(
            7,
            session.search_snapshot(),
            "WARN|fatal".to_string(),
            1,
            0,
            "next".to_string(),
            true,
            true,
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(regex.total_matches, 2);
        assert_eq!(regex.matches[regex.active_match_index - 1].line_number, 2);
        assert_eq!(regex.active_match_index, 1);

        let whole_word = search_text_snapshot(
            7,
            session.search_snapshot(),
            "error".to_string(),
            1,
            1,
            "next".to_string(),
            false,
            false,
            true,
            true,
            true,
        )
        .unwrap();
        assert_eq!(whole_word.total_matches, 1);
        assert_eq!(whole_word.matches[0].line_number, 1);
        assert_eq!(whole_word.active_match_index, 1);

        let single = search_text_snapshot(
            7,
            session.search_snapshot(),
            "error".to_string(),
            1,
            0,
            "next".to_string(),
            false,
            false,
            false,
            true,
            false,
        )
        .unwrap();
        assert_eq!(single.matches.len(), 1);
        assert_eq!(single.matches[0].line_number, 1);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn keeps_multiline_csv_message_as_raw_payload() {
        let path = test_file_path("csv-message.log");
        fs::write(
            &path,
            concat!(
                "13:05:42\t========= Receive Message ([342] S_GET_CSVFILE_RESULT) [21:07:24, 0.058000] =========\n",
                "{\n",
                "    \"File\": {\n",
                "        \"Data\": \"A,B\n",
                "1,2\n",
                "\",\n",
                "        \"Info\": {\"Filename\": \"BadJsonCsv.csv\"}\n",
                "    },\n",
                "    \"Result\": 1\n",
                "}\n",
                "============================================\n",
            ),
        )
        .unwrap();

        let session = LogSession::open(path.clone()).unwrap();

        assert_eq!(session.markers.len(), 1);
        assert_eq!(session.markers[0].message_id, 342);
        assert_eq!(session.markers[0].parse_status, "raw");
        let payload = session
            .marker_payloads
            .get(&session.markers[0].id)
            .expect("payload exists");
        assert!(payload.raw_text.contains("BadJsonCsv.csv"));
        assert!(payload.parse_error.is_some());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn scans_real_game_log_when_available() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("com.sevenpirates.monster.gameLog.log");
        if !path.exists() {
            return;
        }

        let session = LogSession::open(path).unwrap();

        assert!(session.markers.len() >= 100);
        assert!(session.markers.iter().any(
            |marker| marker.message_id == 342 && marker.message_name == "S_GET_CSVFILE_RESULT"
        ));
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.message_id == 42 && marker.message_name == "LOGIN"));
    }

    #[test]
    fn generates_fixture_at_requested_size_floor() {
        let fixture = generate_fixture(1, "mixed").unwrap();

        assert!(fixture.file_size >= 1024 * 1024);
        assert!(fixture.line_count > 0);
        assert_eq!(fixture.profile, "mixed");
        assert!(PathBuf::from(&fixture.path).exists());
        fs::remove_file(fixture.path).unwrap();
    }

    #[test]
    fn generates_dense_marker_fixture_profile() {
        let fixture = generate_fixture(1, "dense-markers").unwrap();
        let session = LogSession::open(PathBuf::from(&fixture.path)).unwrap();

        assert_eq!(fixture.profile, "dense-markers");
        assert!(fixture.file_size >= 1024 * 1024);
        assert!(session.markers.len() > 100);
        assert!(PathBuf::from(&fixture.path).exists());
        fs::remove_file(fixture.path).unwrap();
    }

    #[test]
    fn core_benchmark_reports_reproducible_metrics() {
        let report = run_core_benchmark_sync(1, "short-lines").unwrap();

        assert_eq!(report.fixture.profile, "short-lines");
        assert!(report.fixture.file_size >= 1024 * 1024);
        assert!(report.fixture.line_count > 0);
        assert!(report.read_visible_line_count > 0);
        assert!(PathBuf::from(&report.fixture.path).exists());
        fs::remove_file(report.fixture.path).unwrap();
    }

    fn test_file_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("log-scope-{suffix}-{name}"));
        path
    }

    fn append_bytes(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().append(true).open(path)?;
        file.write_all(bytes)
    }
}
