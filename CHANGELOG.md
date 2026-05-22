# Changelog

All notable changes to the published `techlogia` npm package are
documented in this file. The project follows [Semantic Versioning].

## [0.5.0] — 2026-05-23 (Senior Security Audit)

### Security (P1–P7 from the senior audit)

- **ANSI / terminal-injection protection.** All API responses are passed
  through a `safe()` sanitiser (`src/ui.ts`) before being printed.
  Removes C0 controls, CSI / OSC / DCS sequences. Mitigates the
  Codex-CLI RCE class, OSC-52 clipboard hijack, prompt-injection via
  SGR/CSI. Exception: WS-PTY stream in `lab attach` (passthrough by
  design — your own VM). 9 new tests in `tests/safe.test.ts`.
- **PKCE S256** in the browser login (`commands/auth.ts`). Authorization
  codes are now protected against log leaks / browser-history theft.
  Backend must validate `code_verifier` against the stored challenge
  — coordinate before publish.
- **Loopback HTTP listener hardened.** GET-only, host must be 127.0.0.1
  / localhost (DNS-rebinding), remote address must be loopback,
  path must be `/callback`. State compared in constant time. CSP +
  no-store + nosniff + no-referrer on every HTML response.
- **Tokens at rest encrypted** with AES-256-GCM and a machine-derived
  key (hostname + uid + product string). Plain-text token files from
  pre-0.5 are migrated transparently and removed on first read. Atomic
  write via `.tmp` + rename. `storageBackend()` now returns
  `"file-encrypted"` instead of `"file"`.
- **`update-notifier` removed.** Replaced by a 30-line `fetch()` against
  `registry.npmjs.org`. Drops `got@9` (SSRF) and 5 other transitive
  vulnerabilities. Bundle shrinks from ~190 KB to 101 KB.
- **WS hardened.** Explicit `rejectUnauthorized: true`. 60-second
  idle-ping timeout — dead sessions no longer hold raw stdin captive.
  Detach sequence configurable via `TECHLOGIA_DETACH=^]^]` (the default
  `Ctrl-P Ctrl-Q` collides with Emacs / Tmux).
- **Browser-open URL validation.** `openBrowser()` validates scheme +
  host before `spawn()` — env-controlled `TECHLOGIA_API` cannot
  smuggle a `javascript:` or arbitrary-host URL into the OS shell.
- **CI hardening.** New workflows (`ci.yml`, `publish.yml`). `npm ci
  --ignore-scripts` everywhere — blocks malicious postinstall hooks
  from transitive deps. `npm audit signatures` to verify Sigstore
  attestations. **`npm publish --provenance`** so this CLI itself
  ships with SLSA Build Level 2 provenance and a Sigstore signature.
  Dependabot is restricted to direct deps; major version bumps require
  manual review.

### Removed

- `update-notifier` and its `@types/update-notifier`.

### Migration notes

- The token file location is now `~/.techlogia/tokens.enc` (encrypted).
  The old plain-text `~/.techlogia/tokens.json` is migrated on the
  first read after upgrade — no action required.
- If your shell aliases include `TECHLOGIA_DETACH`, set it to the
  `^X^Y` form (e.g. `^]^]`).

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
