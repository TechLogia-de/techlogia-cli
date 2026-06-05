# Publishing auf npm

**Seit 2026-06-05 läuft der Publish über npm Trusted Publishing (OIDC)
aus GitHub Actions — es gibt KEINEN npm-Token mehr** (weder lokal noch
als GitHub-Secret). Hintergrund: npm hat Ende 2025 alle Classic-Tokens
revoked und Granular-Tokens auf max. 90 Tage begrenzt; der CI-Publish
von 0.5.2 scheiterte am abgelaufenen `NPM_TOKEN` mit `E404`.

## Einmaliges Setup (erledigt, hier zur Referenz)

Auf npmjs.com → Package `techlogia` → **Settings → Trusted Publisher**:

| Feld | Wert |
|---|---|
| Organization or user | `TechLogia-de` |
| Repository | `techlogia-cli` |
| Workflow filename | `publish.yml` (nur der Dateiname, kein Pfad!) |
| Environment name | *(leer)* |

Stolperfallen (kosteten 3 Fehlversuche am 2026-06-05):

1. **Kein `registry-url` in `actions/setup-node`!** Damit schreibt
   setup-node eine `.npmrc` mit `_authToken=${NODE_AUTH_TOKEN}` und
   einem Platzhalter-Fake-Token (`XXXXX-...`) — npm bevorzugt den
   konfigurierten Token vor OIDC und der PUT scheitert mit `E404`.
2. **npm ≥ 11.5.1 nötig** — Node 22 bundelt npm 10.x, deshalb der
   `npm install -g npm@latest`-Step im Workflow.
3. `permissions: id-token: write` muss gesetzt sein (war es schon
   für die Sigstore-Provenance).
4. Debugging: `npm publish --loglevel http` zeigt den OIDC-Exchange
   (`POST /-/npm/v1/oidc/token/exchange/package/techlogia`) — ein
   `404` dort heißt: Trusted-Publisher-Config matcht die Claims nicht.

## Publish-Workflow (Standard: via CI)

```bash
# 1. Im CLI-Repo: sauberer Stand
cd "/Users/antonio/Desktop/Dev Apps/Techlogia_CLI"
npm run lint && npm run build && npm test

# 2. Version bumpen (erstellt Git-Commit + Tag)
npm version patch    # 0.x.Y → Bug-Fixes
# oder: npm version minor   → neue Befehle

# 3. Push — der v*-Tag triggert .github/workflows/publish.yml,
#    der mit OIDC + SLSA-Provenance publisht. Kein npm-Login nötig.
git push origin main --tags

# 4. Verifikation
gh run watch --repo TechLogia-de/techlogia-cli
npm view techlogia version
npm view techlogia dist.attestations   # SLSA-Provenance vorhanden?
```

Manueller Re-Run (z.B. nach Workflow-Fix, Tag existiert schon):
```bash
gh workflow run publish.yml --ref main
```

## Lokaler Publish (Notfall-Fallback)

Nur wenn GitHub Actions ausfällt: `npm login` (Browser-Flow), dann
`npm publish --access public`. **Achtung:** lokal gibt es keine
`--provenance` (braucht CI-OIDC) — der Sigstore-Badge fehlt dann
für diese Version.

## Update auf installierten Maschinen

User mit globaler Install:
```bash
npm update -g techlogia
# oder explizit:
npm install -g techlogia@latest
```

`update-notifier` (in der CLI eingebaut) zeigt automatisch ein Update-Banner
ab dem nächsten Aufruf — kein Cron nötig.

## Versions-Strategie

- **Patch** (0.x.Y): Bug-Fixes, Schema-Drift-Anpassungen, Texte
- **Minor** (0.X.0): Neue Befehle, neue Persona-Features (backwards-compat)
- **Major** (X.0.0): Breaking-Changes (CLI-Argumente umbenannt, etc.)

Bis `1.0.0` heißt **alles** Minor — kein Stabilitäts-Versprechen.

## Pre-Release-Tag

Für Beta-Versionen:
```bash
npm version 0.2.0-beta.0
npm publish --tag beta
# Install:  npm install -g techlogia@beta
```

## Was npm publish hochlädt

Nur die in `package.json#files` gelisteten Pfade + `package.json`/`README`/`LICENSE`:
- `dist/` (gebautes Bundle)
- `README.md`
- `LICENSE`

`.npmignore` zieht zusätzlich `src/`, `tests/`, `tsconfig.json`, etc. ab.
Tokens in `~/.npmrc` werden nie publisht (außerhalb des Repos).

## Notfall: Unpublish

Innerhalb von 72h nach Publish:
```bash
npm unpublish techlogia@0.1.0
```

Nach 72h: nur deprecate-able, nicht löschbar (npm-Policy):
```bash
npm deprecate techlogia@0.1.0 "Buggy release, please use 0.1.1"
```
