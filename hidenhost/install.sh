#!/usr/bin/env bash
# HidenHost one-shot installer — sets up the relay (server.js) and the
# build worker (build-worker.js) on a fresh Linux box.
#
#   curl -fsSL <this file> | bash        # or: bash install.sh
#
# What it does:
#   1. Installs Node deps (npm install --omit=dev)
#   2. Installs Rust via rustup (stable, minimal) if cargo is missing
#   3. Adds the x86_64-pc-windows-gnu rust target
#   4. Installs the mingw-w64 cross-linker (apt/dnf/apk, or portable llvm-mingw)
#   5. Creates .env from .env.example if missing
#   6. Prints how to start server.js + build-worker.js

set -euo pipefail
cd "$(dirname "$0")"

RUST_TARGET="x86_64-pc-windows-gnu"
say()  { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# sudo prefix only when needed and available
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  have sudo && SUDO="sudo" || warn "not root and no sudo — package installs may fail"
fi

# ── 1. Node deps ─────────────────────────────────────────────────────────────
have node || die "node not found — install Node.js 18+ first (https://nodejs.org)"
have npm  || die "npm not found — install Node.js 18+ first (https://nodejs.org)"
say "installing node dependencies…"
npm install --omit=dev

# ── 2. Rust toolchain ────────────────────────────────────────────────────────
export PATH="$HOME/.cargo/bin:$PATH"
if ! have cargo; then
  say "installing Rust via rustup (one-time, ~2 min)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
  export PATH="$HOME/.cargo/bin:$PATH"
fi
have cargo || die "rustup finished but cargo is still missing"
say "rust: $(rustc --version)"

# ── 3. Windows build target ──────────────────────────────────────────────────
if ! rustup target list --installed 2>/dev/null | grep -q "^${RUST_TARGET}$"; then
  say "adding rust target ${RUST_TARGET}…"
  rustup target add "$RUST_TARGET"
fi

# ── 4. mingw-w64 linker (needed for the gnu windows target on Linux) ────────
if ! have x86_64-w64-mingw32-gcc; then
  say "installing mingw-w64 cross-linker…"
  if   have apt-get; then $SUDO apt-get update -y && $SUDO apt-get install -y mingw-w64
  elif have dnf;     then $SUDO dnf install -y mingw64-gcc
  elif have apk;     then $SUDO apk add --no-cache mingw-w64-gcc
  elif have pacman;  then $SUDO pacman -S --noconfirm mingw-w64-gcc
  else
    warn "no supported package manager — downloading portable llvm-mingw…"
    LLVM_MINGW_VER="20240619"
    LLVM_MINGW_DIR="$HOME/.local/llvm-mingw"
    mkdir -p "$LLVM_MINGW_DIR"
    curl -fsSL "https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_VER}/llvm-mingw-${LLVM_MINGW_VER}-ucrt-ubuntu-20.04-x86_64.tar.xz" \
      | tar -xJ --strip-components=1 -C "$LLVM_MINGW_DIR"
    export PATH="$LLVM_MINGW_DIR/bin:$PATH"
    say "llvm-mingw installed to $LLVM_MINGW_DIR — add this to your shell profile:"
    say "  export PATH=\"$LLVM_MINGW_DIR/bin:\$PATH\""
  fi
fi
have x86_64-w64-mingw32-gcc || warn "mingw linker still not on PATH — builds for Windows will fail until it is"

# ── 5. .env ──────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env created from .env.example — edit it and set HIDEN_AUTH_KEY and BUILDSERVER_KEY"
fi

# ── 6. Done ──────────────────────────────────────────────────────────────────
cat <<'EOF'

[install] all set.

Start the relay:
  node server.js

Start the build worker (in a second terminal, or as a service):
  node build-worker.js

Or install the systemd unit:
  sudo cp hidenhost.service /etc/systemd/system/
  sudo systemctl enable --now hidenhost
EOF
