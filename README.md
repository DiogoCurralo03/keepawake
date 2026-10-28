# KeepAwake

[![CI](https://github.com/italoalmeida0/keepawake/actions/workflows/ci.yml/badge.svg)](https://github.com/italoalmeida0/keepawake/actions/workflows/ci.yml)

Keep Windows awake with a native tray icon and startup at sign-in. Built with **Node.js + Koffi**, using the Windows API directly. By **Italo Almeida**, licensed under MIT.

## Install

Requires **Windows 10/11 x64 or ARM64** and **[Node.js 22 or newer](https://nodejs.org/)**, including npm.

Download the ZIP from [Releases](https://github.com/italoalmeida0/keepawake/releases/latest), extract it, and run `install.cmd`. You can also clone the repository and install from a regular terminal:

```powershell
git clone https://github.com/italoalmeida0/keepawake.git
cd keepawake
node scripts/install.js
```

With the usual Windows account permissions, installation does not require administrator privileges. The installer:

- Copies the application and installs its dependencies in `%USERPROFILE%\.keepawake`.
- Adds `keepawake` to the **user** PATH. Open a new terminal to use the command.
- Enables startup when **you sign in**, through `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `KeepAwake.Node`.
- Configures the current power plan to do nothing when the lid closes, on AC and battery power, after backing up the previous values.
- Starts the application without a console window and **without elevation**.

The application uses the Node.js installation that ran the installer. If you move or remove that Node.js installation, reinstall KeepAwake. Installing dependencies requires an internet connection. Run the same installer to update; settings and logs are preserved. The installer uses prebuilt native dependencies and verifies that they load before replacing a running installation.

If a policy or ACL restricts lid configuration, the installer reports that this step is pending. Run **only** `keepawake lid on` once from a terminal with the required permissions, then return to a regular terminal. Restoring the setting may require the same permissions. The daemon refuses to run as administrator. If you run the entire installer elevated, start KeepAwake afterward from a regular terminal.

Installer options:

```powershell
node scripts/install.js --no-startup   # Do not start at sign-in
node scripts/install.js --no-lid       # Leave the lid close action unchanged
node scripts/install.js --no-start     # Install without starting now
node scripts/install.js --no-path      # Leave the user PATH unchanged
node scripts/install.js --root "D:\My folder\KeepAwake"
```

Options can be combined. A custom installation directory must be empty or contain an installation of this KeepAwake application. No Windows service or scheduled task is installed.

## Use

Click the sun icon in the notification area to pause, resume, choose whether the display stays on, or toggle activity simulation. The pause icon indicates that the application is paused. **Quit** exits the process; it starts again at the next sign-in if startup is enabled.

```powershell
keepawake status
keepawake pause 15m
keepawake pause          # Pause until resumed; persists across restarts
keepawake resume
keepawake stop
keepawake start

keepawake config display off   # Allow the display to turn off
keepawake config activity off  # Disable synthetic mouse activity
keepawake config interval 55   # Between 15 and 3600 seconds
keepawake config

keepawake startup off
keepawake startup on
keepawake startup status
keepawake lid status
keepawake lid off              # Restore the saved lid settings
keepawake lid on               # Apply to the current power plan
keepawake status --json
keepawake logs
```

By default, KeepAwake keeps the system and display awake and sends a **zero-displacement** mouse event after approximately 55 seconds of inactivity. It does not move the cursor, click, or type. Activity simulation only runs on the interactive desktop and does not unlock a session. The `display` and `activity` settings are independent: disable both to allow the display to turn off without simulating presence. Pausing releases the power requests and stops simulated activity; it does not change the persistent lid configuration.

Each installation has a single process, protected by a Windows mutex. The native menu runs on a separate thread, so an open menu does not block power checks or shutdown. There are no permanent helper processes or automatic restart loops. Power requests belong to the process thread, and Windows releases them even after an abrupt process exit.

Local control uses HTTP bound only to `127.0.0.1`, with a random authentication token and instance identity checks. The token is stored in the user directory and is not needed in commands. Do not share `state/endpoint.json`.

## Lid, battery, and Windows limits

Keeping a thread active does not replace the configured lid close action. Lid configuration is therefore a separate, persistent change with a backup. It applies to the **current power plan**; run `keepawake lid on` again after switching plans. The application does not continuously overwrite your power settings.

On **Modern Standby** systems, especially on battery power with the display off or lid closed, Windows and firmware can limit power requests and suspend applications. Microsoft documents these [Modern Standby phases and limits](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/prepare-software-for-modern-standby) and the [scope of the execution-state API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate). Indefinite execution with the lid closed cannot be guaranteed on every device. Manual sleep, shutdown, sign-out, critical battery actions, thermal limits, and managed policies remain under Windows control. A process can still appear in Task Manager while its execution is suspended.

The installer only changes the lid close action. It leaves hibernation, critical battery actions, physical power buttons, and lock/password policies intact. Keep the laptop properly ventilated when using it with the lid closed.

## Uninstall

From a regular terminal:

```powershell
keepawake uninstall
# Or:
& "$env:USERPROFILE\.keepawake\bin\uninstall-keepawake.cmd"
```

You can also run `node scripts/uninstall.js` from the source directory, adding `--root` for a custom installation. The uninstaller stops the process and waits for it to exit before deleting files. It removes only its own startup/PATH entries and restores the saved lid settings. Later manual changes are preserved; other power settings are not replaced with assumed defaults.

If Windows denies restoration, the files and backup remain available. Run `keepawake lid off` with the required permissions, then uninstall again.

## Development

```powershell
npm ci
npm run check
npm test

# Optional native tray tests in an interactive Windows session:
$env:KEEPAWAKE_TRAY_TEST = '1'
node --test test/tray.test.js

npm run package
```

Integration tests use temporary installations and do not change your account's startup, PATH, or power settings. Optional tray tests require an interactive desktop. The ZIP in `dist/` contains source, the lockfile, and installers, without preinstalled dependencies. Git is not required to build it.

CI covers Node.js 22, 24, and 26 on Windows x64 and ARM64. [GitHub-hosted Windows runners execute with administrator privileges](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges), so CI launches the integration suite under a dedicated standard user account to test the runtime's actual privilege requirements. That account is created only inside the disposable CI virtual machine.

All maintained source code, comments, documentation, tests, and user-facing messages are in English. See [AGENTS.md](AGENTS.md) for project conventions.

## Recovery provenance

The supplied .NET executables were decompiled with ILSpy. Recovered C# and executable hashes are in [`recovered/`](recovered/README.md). Original executables, scripts, and notes are preserved in the local `og/` archive, which is excluded from the repository and distribution. Local tools in `.tools/` are also excluded.
