use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom, Write},
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
    sessions: Mutex<HashMap<u64, Arc<LogSession>>>,
}

struct LogSession {
    path: PathBuf,
    file_size: u64,
    line_offsets: Vec<u64>,
    index_duration_ms: u128,
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
    sessions.insert(session_id, Arc::new(session));

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

    session
        .read_lines(session_id, start_line, line_count)
        .map_err(|err| err.to_string())
}

impl LogSession {
    fn open(path: PathBuf) -> std::io::Result<Self> {
        let started_at = Instant::now();
        let file = File::open(&path)?;
        let file_size = file.metadata()?.len();
        let line_offsets = build_line_index(file, file_size)?;
        let index_duration_ms = started_at.elapsed().as_millis();

        Ok(Self {
            path,
            file_size,
            line_offsets,
            index_duration_ms,
        })
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

fn build_line_index(file: File, file_size: u64) -> std::io::Result<Vec<u64>> {
    if file_size == 0 {
        return Ok(Vec::new());
    }

    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut line_offsets = vec![0];
    let mut absolute_offset = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];

    loop {
        let read_count = reader.read(&mut buffer)?;
        if read_count == 0 {
            break;
        }

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

    Ok(line_offsets)
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
            get_log_lines
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
}
