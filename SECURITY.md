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

## Hardening implemented (2026-05-23, v0.5.0 senior audit)

This CLI ships with defense-in-depth measures against the most common
classes of CLI-tool vulnerabilities. If you find a gap, please report it
to `security@techlogia.de`.

- **ANSI/Terminal-Injection protection:** all strings received from the
  Techlogia API are passed through a `safe()` sanitizer before being
  written to the terminal. Removes C0 control characters, CSI/OSC/DCS
  sequences. Mitigates the Codex-CLI-style RCE class (CVE-2024-9956 family),
  OSC-52 clipboard hijack, and prompt-injection via SGR/CSI.
  Exception: the WebSocket PTY stream in `lab attach` is a passthrough
  from a user-owned VM and intentionally allows ANSI.

- **OAuth Authorization-Code flow with PKCE (S256):** the browser-based
  login flow uses RFC 7636 PKCE in addition to a CSRF state. Defeats
  authorization-code interception via log leaks, browser history, or
  insider DB access.

- **Hardened loopback HTTP listener:** during `techlogia login --web`,
  the local callback server enforces (a) `GET` only, (b) `Host: 127.0.0.1`
  or `localhost` (DNS-rebinding protection), (c) `127.0.0.1`/`::1`
  remote address (paranoia), (d) `/callback` path only. State is compared
  in constant time. Responses include strict CSP, `nosniff`,
  `Referrer-Policy: no-referrer`.

- **Token encryption at rest:** when the OS keychain is unavailable
  (Linux without libsecret, container, CI), tokens are stored
  AES-256-GCM-encrypted with a machine-derived key (hostname + UID +
  product string). Plain-text fallback files from prior versions are
  migrated transparently on first read and deleted afterwards.

- **WebSocket hardening (`lab attach`):** `rejectUnauthorized: true`
  explicit (defense-in-depth in case future agent config changes that),
  60-second idle-ping timeout, configurable detach sequence via
  `TECHLOGIA_DETACH=^]^]` (Emacs/Tmux compatibility).

- **Browser-open URL validation:** the URL passed to `open`/`xdg-open`/
  `start` is validated (must be `http`/`https`, host on a small allowlist
  unless `TECHLOGIA_API` is set explicitly).

- **No `update-notifier`:** replaced with a 30-line `fetch()` against
  `registry.npmjs.org/{pkg}/latest`. Removed nine transitive vulnerable
  dependencies including `got@9` (SSRF).

- **Supply-chain hardening (CI):** `npm ci --ignore-scripts` to block
  malicious `postinstall` hooks; `npm audit signatures` to verify Sigstore
  attestations on installed packages; `npm publish --provenance` so this
  CLI itself ships with SLSA Build Level 2 provenance + a verifiable
  Sigstore signature. Dependabot is restricted to direct deps,
  major-version updates require manual review.

## How to verify the publish provenance

After install, you can verify this CLI's npm provenance:

```bash
npm view techlogia --json | jq '.dist'
# Look for `provenance.predicateType` = "https://slsa.dev/provenance/v1"
```

Or via the registry API:

```bash
curl -s https://registry.npmjs.org/-/npm/v1/attestations/techlogia@<version>
```

This proves which GitHub Actions workflow built and published the
tarball — independent of any compromise of npm publisher credentials.
