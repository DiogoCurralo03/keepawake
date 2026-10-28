# Recovered source

Recovered on October 28, 2026, from executables supplied by the project owner, using **ilspycmd 9.1.0.7988**. Decompilation recovers the C# logic, but not the original comments, local variable names, or project files. Both executables contain the same recovered logic.

The recovered C# output messages have been translated to English. The original executables remain unchanged in the local `og/` archive and are identified by these SHA-256 hashes:

| Original executable | SHA-256 |
| --- | --- |
| `og/KeepAwake.exe` | `702D0E51B255B34D1DDB8884629A605D7B4964B542C338529EA31C503EE23021` |
| `og/KeepAwake-console.exe` | `53A417F79499B19CDECA121E4830424F4892639BD78CE8F16755B200BC2369CF` |

The original uses `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)`, `SendInput` with zero relative mouse movement, and a single-instance mutex. It reads `PollSeconds`, `InputSim`, and `BreakOnBattery` from `HKCU\Software\KeepAwakeTool`. Lid configuration was external to the executable, as shown by the supplied scripts and notes.

The Node.js version replaces the original three-second battery pause with explicit pause controls that release power requests. It does not automatically migrate the old version's registry keys, processes, or power changes. It manages its own installation and the settings it explicitly backs up.

## Original session recovered later

A privately supplied session history subsequently allowed recovery of twelve original source/configuration files, including `KeepAwake.cs`, `fix_lid.ps1`, `regcheck.ps1`, `build.ps1`, and `verify.ps1`. The raw files are kept in the local `og/` archive and are not published because the history includes private machine details.

The history confirms that lid configuration used the documented `powercfg /setacvalueindex`, `/setdcvalueindex`, and `/setactive` commands. `regcheck.ps1` only read values. Successful historical output reported the correct lid setting, GUID `5ca83367-6e45-459f-a27b-476b1d01c936`, as Do Nothing for AC and DC.

Some earlier diagnostic attempts used an incorrect lid GUID and an incorrect console-display timeout GUID. Those failed probes are not reliable evidence that the real setting was missing. The old setup also changed unrelated display, sleep, physical-button, and battery settings; the Node.js application retains its narrower scope of backed-up lid changes and does not copy those changes blindly.

The recovered history does not establish that current managed policies still permit the same configuration. It also does not provide a controlled long-duration physical lid test. A successful command and plan readback must be distinguished from proof that the current laptop will never lock or suspend.
