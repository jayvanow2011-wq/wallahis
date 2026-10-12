Wallahis Agent — Windows build bundle
=====================================

What's in this folder
---------------------
  install.bat        One-click: installs Python deps, then runs build_agent.py
  build_agent.py     Downloads Rust + VS Build Tools (if missing), writes the
                     server URLs / auth key into the source, then compiles
                     sentinel-agent.exe.
  requirements.txt   Python packages (just `requests`).
  dist/              Where the finished .exe lands.

How to use
----------
1. Copy the whole `agent/` folder onto your Windows machine
   (so you have `agent/rust/` AND `agent/windows-setup/` next to each other).
2. Right-click `install.bat` -> Run as administrator.
3. Wait. First run can take 10-30 min because it may download the Visual
   Studio Build Tools (a few GB). Later runs skip that and build in ~2 min.
4. When it finishes you get:
      agent\windows-setup\dist\sentinel-agent.exe
      <Your Desktop>\sentinel-agent.exe

Flags (optional)
----------------
  install.bat --release       Build without the debug console window.
  install.bat --name myagent  Override BUILD_NAME baked into the exe.
  install.bat --skip-vs       Skip the VS Build Tools check (you have them).

Pre-baked configuration
-----------------------
  Server    https://wallahis.lovable.app
  Relay WS  wss://umad.servemc.net
  Relay    https://umad.servemc.net
  AuthKey   wallahijayiscool
  Owner     user id 1  (jayjay admin)
  Debug     ON by default (console window shows logs)

If you move the relay or rotate the auth key, edit the constants at the top
of build_agent.py and re-run install.bat.

Troubleshooting
---------------
* "python not found"   -> install Python 3.10+ from python.org and tick
                          "Add python.exe to PATH".
* "link.exe not found" -> VS Build Tools didn't finish; re-run install.bat.
* Antivirus deletes the exe -> add an exclusion for this folder; the agent
  does low-level input/screenshot stuff that triggers heuristics.
