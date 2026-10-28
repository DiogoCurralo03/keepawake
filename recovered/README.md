# Recovered source

Recovered on October 28, 2026, from executables supplied by the project owner, using **ilspycmd 9.1.0.7988**. Decompilation recovers the C# logic, but not the original comments, local variable names, or project files. Both executables contain the same recovered logic.

The recovered C# output messages have been translated to English. The original executables remain unchanged in the local `og/` archive and are identified by these SHA-256 hashes:

| Original executable | SHA-256 |
| --- | --- |
| `og/KeepAwake.exe` | `702D0E51B255B34D1DDB8884629A605D7B4964B542C338529EA31C503EE23021` |
| `og/KeepAwake-console.exe` | `53A417F79499B19CDECA121E4830424F4892639BD78CE8F16755B200BC2369CF` |

The original uses `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)`, `SendInput` with zero relative mouse movement, and a single-instance mutex. It reads `PollSeconds`, `InputSim`, and `BreakOnBattery` from `HKCU\Software\KeepAwakeTool`. Lid configuration was external to the executable, as shown by the supplied scripts and notes.

The Node.js version replaces the original three-second battery pause with explicit pause controls that release power requests. It does not automatically migrate the old version's registry keys, processes, or power changes. It manages its own installation and the settings it explicitly backs up.
