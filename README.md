# Techlogia CLI

Die [Techlogia](https://techlogia.de)-Lernplattform direkt im Terminal: Module
browsen, Lektionen lesen, VM-Lab-Sessions starten, Klassen verwalten — alles
ueber `techlogia <befehl>`. Ein API-Konsument neben Web und Flutter-App.

## Installation

```bash
npm install -g techlogia
```

`node >= 18` erforderlich. JWT-Tokens werden im OS-Keychain abgelegt
(macOS Keychain / GNOME Keyring / Windows Credential Manager via `keytar`).
Auf Systemen ohne Secret-Store fällt der Storage automatisch auf eine
`chmod 600`-Datei unter `~/.techlogia/tokens.json` zurück.

## Persona-Varianten

Die CLI passt das Hauptmenü an Deine Rolle an — Server bleibt Source-of-Truth
für Authorization, Client filtert nur die Sichtbarkeit.

| Rolle | Beschreibung |
|---|---|
| **Gast** | Nicht angemeldet — Blog, Legal, Health |
| **Lerner** | Lab-Zugang via Email-Login |
| **Schueler** | Klassen-Code-Login, eingeschränkter Lab-Zugang |
| **Lehrer** | Klassen + Schüler + Modul-Sichtbarkeit |
| **Schul-Admin** | Lehrer + Klassen einer Schule |
| **Redakteur** | Blog/Legal/Lab-Inhalte pflegen |
| **Viewer** | Read-only Admin-Panel |
| **Plattform-Admin** | Volle Verwaltung |

Alle Personas auflisten: `techlogia personas`.

## Schnellstart

```bash
# API-Erreichbarkeit prüfen (kein Login nötig)
techlogia health

# Letzte Blog-Beiträge im Terminal lesen
techlogia blog list
techlogia blog read <slug>

# Impressum / Datenschutz / AGB anzeigen
techlogia legal show impressum

# Anmelden (Email + Passwort, MFA wird abgefragt wenn aktiviert)
techlogia login

# Aktive Persona zeigen
techlogia whoami

# Lab-Module browsen (Lerner / Schüler / Lehrer)
techlogia lab modules
techlogia lab lessons --module docker-basics
techlogia lab read <lesson-slug>

# VM-Session starten / Status / Stop
techlogia lab start docker-basics
techlogia lab status
techlogia lab stop <session-id>

# Schüler-Login per Klassen-Code (kein Email/Passwort)
techlogia student login

# Lehrer-Workflows
techlogia class list
techlogia class create
techlogia class students <class-id>

# Schul-Admin
techlogia school teachers
techlogia school create-teacher
```

## Konfiguration

| Variable | Default | Beschreibung |
|---|---|---|
| `TECHLOGIA_API` | `https://techlogia.de` | API-Base-URL (für Staging/Dev) |

Locale (`de`/`en`) wird im persistenten Config-Store gespeichert
(`~/Library/Preferences/techlogia-nodejs/config.json` auf macOS).

## Identifikation

Jeder Request trägt einen klaren User-Agent:

```
TechlogiaCLI/<version> (<platform>; node-<version>)
```

So weiß das Backend, dass der Request von der CLI kommt — relevant z. B.
für Rate-Limit-Pools oder mobile-Browser-Blocks, die nicht auf die CLI
zutreffen sollen.

## Beitragen

Issues und PRs willkommen auf https://github.com/TechLogia-de/techlogia-cli

## Lizenz

MIT
