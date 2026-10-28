# Project conventions

Use English for all source code, identifiers, comments, documentation, tests, user-facing messages, commit messages, and release notes. Unicode test fixtures may use escaped characters to verify international path and data handling.

Keep the runtime under a standard Windows user token. Limit persistent power changes to explicitly configured lid settings, save their previous values, and preserve later user changes during restoration.

Run `npm run check` and `npm test` before publishing changes. Native tray tests are optional and require an interactive Windows desktop: set `KEEPAWAKE_TRAY_TEST=1` to enable them. Do not commit local originals in `og/`, tools, dependencies, runtime state, logs, or generated distribution archives.
