# Contributing to techlogia CLI

Thanks for considering a contribution. This document covers the local
development setup, code style, and how to get a pull request merged.

## Development setup

```bash
git clone https://github.com/TechLogia-de/techlogia-cli.git
cd techlogia-cli
npm install
npm run dev -- --help        # run from TypeScript source
npm run build                # produce dist/index.js
npm test                     # vitest suite
npm run lint                 # tsc --noEmit (no separate ESLint yet)
```

To run against a local backend instead of production:

```bash
TECHLOGIA_API=http://localhost:8000 npm run dev -- health
```

## Project layout

```
src/
├── index.ts              # entry point (shebang injected by tsup)
├── cli.ts                # commander wiring + persona-aware help
├── shell.ts              # interactive REPL mode
├── banner.ts             # ASCII logo, prompt builder, help renderer
├── config.ts             # persistent user preferences (conf)
├── personas.ts           # role → allowed-commands mapping
├── ui.ts                 # chalk helpers, error formatting
├── api/
│   ├── client.ts         # axios instance, 401-refresh interceptor
│   ├── storage.ts        # JWT storage (keytar + file fallback)
│   └── types.ts          # response-type definitions and helpers
└── commands/
    ├── auth.ts           # login (browser + terminal), logout, whoami
    ├── attach.ts         # WebSocket terminal into the lab VM
    ├── validate.ts       # task validator
    ├── lab.ts            # modules, lessons, sessions
    ├── teacher.ts        # class management
    ├── school.ts         # teacher / school management
    ├── student.ts        # class-code login
    └── …
```

## Code style

- **TypeScript strict mode**, no `any`. Use generics or `unknown` + a
  type guard.
- **Functional and small**. Files stay below ~250 LOC where possible.
- **Comments explain why, not what**. A short `why:` comment is more
  valuable than restating the code. Prefer the comment style used in
  existing files.
- **No business logic in commander callbacks**. Wrappers around pure
  functions are easier to test.
- **No emojis** in source code or commit messages. Logs and CLI output
  may use unicode glyphs where they add semantic value (status dots).

## Commit messages

```
<type>(<scope>): short imperative summary (≤72 chars)

<body — wrap at 72, explain the why, list breaking changes>
```

`<type>` is one of: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`,
`build`, `ci`, `chore`. `<scope>` is the touched module (`auth`,
`shell`, `lab`, …) or `core` for cross-cutting changes.

## Tests

Smoke tests live in `tests/`. We use Vitest. Network calls are mocked;
the test suite must run offline.

Add a test alongside any non-trivial change. Type errors caught by
`tsc --noEmit` count as a test for the type system.

## Pull-request workflow

1. Fork the repo, create a topic branch off `main`.
2. Keep PRs focused — one logical change per PR.
3. Run `npm run lint && npm run build && npm test` locally.
4. Describe the *why* and the *blast radius* in the PR body. Link
   any related issues.
5. The maintainers will review within a reasonable time. PRs that touch
   security-sensitive code (`auth.ts`, `storage.ts`, `attach.ts`, the
   browser-login flow) get an explicit security review.

## Security-relevant changes

If your change touches credential handling, the WebSocket terminal, the
OAuth callback flow, or any privilege check, please:

- Document the threat model in the PR
- Add or update tests where applicable
- Cite the relevant section of `SECURITY.md` if your change is meant to
  mitigate a known risk

For confidential disclosure of a vulnerability, please follow the
process in [`SECURITY.md`](./SECURITY.md) instead of opening a public
issue.

## License

By contributing you agree that your contributions are licensed under
the MIT License (see [`LICENSE`](./LICENSE)).
