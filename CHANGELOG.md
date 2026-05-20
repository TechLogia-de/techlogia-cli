# Changelog

All notable changes to the published `techlogia` npm package are
documented in this file. The project follows [Semantic Versioning].

## [0.3.2]

### Security

- Removed a hard-coded Hetzner VM IP from `scripts/preview-shell.ts`.
  Replaced with RFC-5737 documentation IP / null UUID.
- Logout now warns explicitly when the server-side blacklist call
  fails. Local tokens are still cleared, but the user is informed
  that the refresh token remains valid until natural expiry.
- Added `SECURITY.md` with disclosure policy.
- Added Linux note in the README pointing to `libsecret-1-dev` for the
  OS-keychain path.

## [0.3.1]

### Added

- After a successful `techlogia login` or `techlogia student login`,
  the CLI drops you straight into the interactive shell — no second
  invocation required.

## [0.3.0]

### Added

- **Browser-based login by default** (`techlogia login`). Authorisation-
  code flow with state pinning, single-use codes, loopback-only
  redirect, and a 5-minute listener timeout. Falls back to terminal
  prompt with `--terminal` or when `--email` / `--password` are given.
- Web login supports email / password and OAuth (Google, GitHub) once
  the matching backend route is configured.

### Changed

- The local listener binds `127.0.0.1` only (never `0.0.0.0`).
- The CLI no longer prompts for credentials at the terminal by
  default. Use `--terminal` for the previous behaviour.

## [0.2.2]

### Fixed

- Shell: `logout` now resets the in-process state. The prompt
  immediately switches to a guest prompt; persona and active session
  refresh on the spot.
- Shell: `techlogia <command>` inside the shell is now stripped to
  `<command>` — no more "unknown command 'techlogia'" errors.

### Added

- Slash-prefix commands: `/login`, `/logout`, `/help`, `/exit`, `/clear`,
  `/whoami`. They are optional aliases of the bare commands.
- Anonymous shell start is allowed. Running `techlogia` without a prior
  login opens a guest prompt with login hints.

## [0.2.1]

### Added

- Modern shell welcome screen with ASCII logo, gradient colouring,
  status block (persona, XP, active VM) and a two-line prompt with
  live status dots.

## [0.2.0]

### Added

- **Interactive shell mode**: `techlogia` without arguments opens a
  REPL with command history, persona-aware help and live session
  status. Inspired by `mongosh` / `aws shell` / `gcloud interactive`.

## [0.1.3] - 0.1.0

Initial public releases. See git history for details.

[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
[0.3.2]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.3.2
[0.3.1]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.3.1
[0.3.0]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.3.0
[0.2.2]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.2.2
[0.2.1]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/TechLogia-de/techlogia-cli/releases/tag/v0.2.0
