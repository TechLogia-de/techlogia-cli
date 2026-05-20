# Publishing auf npm

## Einmaliges Setup

### 1) Token rotieren (WICHTIG)

Der Token, der versehentlich im Chat gepasted wurde, muss sofort rotiert
werden:
- https://www.npmjs.com/settings/~/tokens
- "Generate New Token" → Type "Automation" (für CI) oder "Publish" (für lokal)
- Granular: Packages scope `techlogia`, write access
- Den alten Token löschen

### 2) ~/.npmrc anlegen (lokal, NIE im Repo)

```bash
# ~/.npmrc (chmod 600)
//registry.npmjs.org/:_authToken=npm_NEUER_TOKEN_HIER
```

Oder via Login (interaktiv):
```bash
npm login
```

### 3) Verify

```bash
npm whoami    # sollte dein Username zeigen
```

## Publish-Workflow

```bash
# 1. Im CLI-Repo
cd "/Users/antonio/Desktop/Dev Apps/Techlogia_CLI"

# 2. Sauberer Build + Tests
npm run lint
npm run build
npm test

# 3. Version bumpen (patch/minor/major)
#    Erstellt einen Git-Commit + Tag.
npm version patch    # 0.1.0 → 0.1.1
# oder: npm version minor   → 0.2.0
# oder: npm version major   → 1.0.0

# 4. Publish (prepublishOnly-Hook baut + testet nochmal)
npm publish

# 5. Verifikation
npm view techlogia
npm view techlogia version
```

## Erste Veröffentlichung

```bash
cd "/Users/antonio/Desktop/Dev Apps/Techlogia_CLI"
npm publish
# Beim ERSTEN publish prüft npm, ob der Name "techlogia" frei ist.
# Status: AKTUELL FREI (geprüft 2026-05-20).
```

Falls der Name in der Zwischenzeit belegt ist, auf Scope umstellen:
```bash
# In package.json:  "name": "@techlogia/cli"
npm publish --access public
```

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
