# Security Policy

## Supported Versions

Only the latest minor on npm is supported. Older versions receive no
security fixes — please upgrade with `npm install -g techlogia@latest`.

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security-sensitive bugs.

Send a report to **security@techlogia.de** with:

- A short description of the issue
- Steps to reproduce (the smaller the better)
- Impact assessment (what an attacker could do)
- Optionally a suggested fix

We aim to acknowledge within **48 hours** on weekdays and a first
analysis within **7 days**. Fixes for critical / high-severity issues
are released as patch versions; you will be credited in the release
notes unless you ask otherwise.

## Scope

In scope:
- Code in this repository (`github.com/TechLogia-de/techlogia-cli`)
- The published npm package `techlogia`
- The CLI-specific server endpoints `/api/auth/cli/*` and
  the `/cli-auth` frontend page they depend on

Out of scope (please file with the main project / Hetzner abuse):
- General techlogia.de application bugs (use the regular contact form)
- VM-internal attacks during a normal Lab session (the VM is sandboxed
  by design — escape attempts via the VM are platform-level, not CLI-
  level)
- Issues that require physical access to the user's machine

## What We Already Do

- Tokens stored in OS keychain (macOS / GNOME / Windows) via `keytar`;
  fallback file is `chmod 600`.
- HTTPS-only (`techlogia.de`) — the CLI does not accept downgrade to
  plain HTTP except via `TECHLOGIA_API` override for local development.
- WebSocket terminal uses TLS plus subprotocol-auth (JWT in
  `Sec-WebSocket-Protocol` header) — no token in URL or query.
- Browser-OAuth uses Authorization-Code flow with PKCE-style state
  pinning, single-use codes (Redis `GETDEL`, atomic), loopback-only
  redirect URI (`127.0.0.1`), 120-second code TTL, 5-minute listener
  timeout.
- Backend uses parameterised SQLAlchemy queries throughout — no string
  interpolation. CLI has no direct database access.
- Lab abuse detection (CPU / bandwidth / process / content watchers)
  operates server-side and applies equally to CLI-spawned and
  browser-spawned VMs.

## Known Limitations

- The fallback token file (used when `keytar` is unavailable) is plain
  JSON with `chmod 600`. On systems without OS keychain, install
  `libsecret-1-dev` (Linux) or use the macOS/Windows builds where a
  native keychain is available by default.
- `npm audit` may show advisories in dev-dependencies (`esbuild` via
  `vitest`, `got` via `update-notifier`); these are not bundled into
  the published package (`dist/index.js`) and pose no runtime risk.

## Coordinated Disclosure Timeline

Default: **90 days** from acknowledgement to public disclosure. We may
ask for an extension if a fix is non-trivial; we will not silently sit
on a confirmed bug.
