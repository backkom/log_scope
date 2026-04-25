use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

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
    generation_duration_ms: u128,
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

    Ok(metadata)
}

#[tauri::command]
async fn generate_log_fixture(size_mb: u64) -> Result<FixtureMetadata, String> {
    let safe_size_mb = size_mb.clamp(1, 512);
    tauri::async_runtime::spawn_blocking(move || generate_fixture(safe_size_mb))
        .await
        .map_err(|err| format!("failed to join fixture generation task: {err}"))?
        .map_err(|err| err.to_string())
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

impl LogSession {
    fn open(path: PathBuf) -> std::io::Result<Self> {
        let started_at = Instant::now();
        let file = File::open(&path)?;
        let file_size = file.metadata()?.len();
        let (line_offsets, ended_with_newline) = build_line_index(file, file_size)?;
        let (markers, marker_payloads) = scan_message_markers(&path, file_size)?;
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
        let (markers, marker_payloads) = scan_message_markers(&self.path, self.file_size)?;
        self.markers = markers;
        self.marker_payloads = marker_payloads;
        Ok(())
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

fn scan_message_markers(
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
                close_message_marker(current, line_number, line_end_byte, &mut markers, &mut payloads);
                continue;
            }
        }

        if let Some(current) = open_marker.as_mut() {
            current.body_lines.push(line_text);
        }
    }

    if let Some(current) = open_marker.take() {
        close_message_marker(current, line_number, file_size, &mut markers, &mut payloads);
    }

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
    let parsed_json = serde_json::from_str::<serde_json::Value>(&raw_text);
    let (parse_status, parsed_json, parse_error) = match parsed_json {
        Ok(value) => ("ok".to_string(), Some(value), None),
        Err(err) if raw_text.trim().is_empty() => ("raw".to_string(), None, None),
        Err(err) => ("raw".to_string(), None, Some(err.to_string())),
    };
    let color = if marker.header.direction == "Receive" {
        "#4da3ff"
    } else {
        "#42c77a"
    };

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
        parse_status,
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

fn generate_fixture(size_mb: u64) -> std::io::Result<FixtureMetadata> {
    let target_bytes = size_mb * 1024 * 1024;
    let fixture_dir = std::env::temp_dir().join("log_scope").join("fixtures");
    fs::create_dir_all(&fixture_dir)?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = fixture_dir.join(format!("logscope-fixture-{size_mb}mb-{suffix}.log"));

    let started_at = Instant::now();
    let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, File::create(&path)?);
    let mut written = 0_u64;
    let mut line_count = 0_usize;

    while written < target_bytes {
        line_count += 1;
        let severity = match line_count % 5 {
            0 => "ERROR",
            1 | 2 => "INFO",
            _ => "WARN",
        };
        let line = format!(
            "2026-04-25T12:{:02}:{:02}.{:03}Z {severity} worker={} request_id=req-{:08} stage=fixture message=\"synthetic log row for virtualization and indexing validation\" value={}\n",
            (line_count / 60) % 60,
            line_count % 60,
            line_count % 1000,
            line_count % 16,
            line_count,
            line_count % 997
        );
        writer.write_all(line.as_bytes())?;
        written += line.len() as u64;
    }

    writer.flush()?;
    let file_size = fs::metadata(&path)?.len();

    Ok(FixtureMetadata {
        path: path.to_string_lossy().into_owned(),
        file_size,
        line_count,
        generation_duration_ms: started_at.elapsed().as_millis(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            health_check,
            open_file_placeholder,
            open_log_file,
            generate_log_fixture,
            get_log_lines,
            get_log_markers,
            get_marker_payload,
            refresh_log_file
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
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.message_id == 342
                && marker.message_name == "S_GET_CSVFILE_RESULT"));
        assert!(session
            .markers
            .iter()
            .any(|marker| marker.message_id == 42 && marker.message_name == "LOGIN"));
    }

    #[test]
    fn generates_fixture_at_requested_size_floor() {
        let fixture = generate_fixture(1).unwrap();

        assert!(fixture.file_size >= 1024 * 1024);
        assert!(fixture.line_count > 0);
        assert!(PathBuf::from(&fixture.path).exists());
        fs::remove_file(fixture.path).unwrap();
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
