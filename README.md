# techlogia

[![npm version](https://img.shields.io/npm/v/techlogia.svg)](https://www.npmjs.com/package/techlogia)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/techlogia.svg)](https://nodejs.org/)

The official command-line client for the [Techlogia](https://techlogia.de)
learning platform. Browse lab modules, read lessons in your terminal,
spawn and connect to short-lived Linux training VMs, validate task
checks — all without leaving the shell.

## Features

- **Role-aware commands.** The CLI detects your role (learner, student,
  teacher, school admin, platform admin) from the server and shows only
  the commands you can actually use. The server remains the source of
  truth for authorisation; the CLI only filters the menu.
- **Interactive shell mode.** Run `techlogia` without arguments to drop
  into a REPL with persona-aware prompt, command history, slash-prefix
  shortcuts (`/login`, `/help`, `/exit`) and live status of your
  running VM session.
- **Browser-based login by default.** `techlogia login` opens your
  browser, lets you authenticate with email / password or via OAuth
  (Google, GitHub), and exchanges a one-time code for a JWT — no
  password ever touches your shell history.
- **Real VM terminal.** `techlogia lab attach` opens a fully
  interactive WebSocket terminal into your live training VM. Detach
  with `Ctrl-P Ctrl-Q` (the VM keeps running), reconnect any time.
- **Task validator.** `techlogia lab validate <task>` runs the same
  server-side checks as the web player and prints `pass` / `fail`
  with hints and Lynis-score deltas.

## Installation

```bash
npm install -g techlogia
```

Requirements:

| Platform | Required |
|---|---|
| macOS 11+ | Node.js ≥ 18 |
| Linux | Node.js ≥ 18, `libsecret-1-dev` recommended for OS keychain |
| Windows 10+ | Node.js ≥ 18 |

JWT credentials are stored in your operating-system keychain
(`macOS Keychain` / `GNOME Keyring` / `Windows Credential Manager`)
via [`keytar`](https://github.com/atom/node-keytar). On systems without
a secret store the CLI falls back to a `0600`-permissioned JSON file at
`~/.techlogia/tokens.json` — functional, but install `libsecret` for
better protection against process-level access.

## Quick start

```bash
# 1. Verify the API is reachable (no login needed)
techlogia health

# 2. Authenticate via browser (email / password or OAuth)
techlogia login

# 3. Drop into the interactive shell
techlogia
```

Inside the shell:

```
╭─ learner · jane
╰─❯ lab modules
╭─ learner · jane
╰─❯ lab start ssh-hardening
╭─ learner · jane · ⚡ a91f4b2c
╰─❯ lab attach          # Ctrl-P Ctrl-Q to detach
╭─ learner · jane · ⚡ a91f4b2c
╰─❯ lab validate disable-permitrootlogin
```

## Command overview

### Public (no login required)

| Command | Description |
|---|---|
| `techlogia health` | API reachability check |
| `techlogia status` | Local CLI status (version, API, persona) |
| `techlogia blog list` | List recent blog posts |
| `techlogia blog read <slug>` | Render a blog post in the terminal |
| `techlogia legal show <slug>` | Show legal text (`impressum`, `datenschutz`, `agb`) |
| `techlogia personas` | List all role variants |

### Authentication

| Command | Description |
|---|---|
| `techlogia login` | Browser-based login (default) |
| `techlogia login --terminal` | Email / password prompt in the terminal |
| `techlogia logout` | Revoke tokens locally and server-side |
| `techlogia whoami` | Show authenticated identity and role |
| `techlogia student login` | Class-code login for school students |

### Lab (learners, students)

| Command | Description |
|---|---|
| `techlogia lab modules` | List available modules |
| `techlogia lab lessons [--module <slug>]` | List lessons |
| `techlogia lab read <slug>` | Read a lesson (Markdown render) |
| `techlogia lab start <module>` | Provision a new lab VM |
| `techlogia lab status` | Show the active session |
| `techlogia lab attach [--last]` | Open a terminal into the VM |
| `techlogia lab validate <task>` | Run a task check on the VM |
| `techlogia lab stop --last` | Terminate the current session |
| `techlogia lab cost` | Today's lab cost vs. daily limit |

### Teaching (teachers, school admins)

| Command | Description |
|---|---|
| `techlogia class list` | List your classes |
| `techlogia class create` | Create a new class |
| `techlogia class students <id>` | List students in a class |
| `techlogia class quota <id> --max <n>` | Set daily session limit (1-10) |
| `techlogia school teachers` | List teachers of your school |
| `techlogia school create-teacher` | Invite a new teacher |

Use `techlogia <command> --help` for full per-command options.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `TECHLOGIA_API` | `https://techlogia.de` | API base URL (for staging or local backend) |
| `NO_UPDATE_NOTIFIER` | unset | Set to `1` to disable the daily version-check |

User preferences live in a [`conf`](https://github.com/sindresorhus/conf)
store at the OS-standard location
(e.g. `~/Library/Preferences/techlogia-nodejs/`).

## Architecture

The CLI is a stateless HTTPS / WebSocket client for the Techlogia
backend. It does not connect to any third-party service at runtime
beyond:

- `registry.npmjs.org` for the once-daily update check
  (opt-out via `NO_UPDATE_NOTIFIER=1`)
- The OS keychain provider (`Keychain.app`, GNOME Keyring or Credential
  Manager) for token storage

It speaks the same public REST endpoints as the web frontend (`techlogia.de`)
and the official mobile app — token format, authentication and validation
logic are identical.

Each request carries a stable user-agent header for transparency:

```
TechlogiaCLI/<version> (<platform>; node-<version>)
```

This header is used solely on the server side to distinguish web,
mobile and CLI traffic for rate-limit pools and analytics; it carries
no personal data.

## Security

Token storage, transport, and the browser-login flow are documented in
[`SECURITY.md`](./SECURITY.md), which also describes how to report a
vulnerability.

In summary:

- TLS-only transport, JWT in `Authorization: Bearer` header
- WebSocket terminal uses subprotocol-based authentication
  (`techlogia.lab.v1`, JWT as second protocol value) — no token in URL
- Browser login uses Authorization-Code flow with state pinning,
  single-use codes (atomic Redis `GETDEL`), loopback-only redirect URI
  (`127.0.0.1`), 120-second code TTL, 5-minute listener timeout
- Token-refresh runs single-flight (parallel 401s share one refresh,
  no token-rotation race)

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for development setup, code style, and pull-request guidelines.

## License

[MIT](./LICENSE)
