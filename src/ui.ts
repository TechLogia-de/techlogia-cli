import chalk from "chalk";
import { AxiosError } from "axios";

// chalk@4 ist CJS — bundle-bar. chalk@5 ist ESM-only und wuerde unseren
// CJS-Build sprengen. Falls jemand spaeter migriert: ESM-Migration ist
// non-trivial wegen require()-Aufrufen im Code.

// ─── ANSI / Terminal-Injection Schutz (P1, 2026-05-23) ────────────────────
// Server-Daten (Lehrer-Nachrichten, Lab-Output, error.detail) duerfen
// NIE ungefiltert ins Terminal — siehe CVE-Klasse Codex-CLI (RCE via OSC),
// clipboard-hijack via OSC-52, prompt-injection via CSI/SGR-Sequenzen.
//
// Die Regex erfasst:
//   - C0-Steuerzeichen (0x00-0x08, 0x0B-0x1F, 0x7F) AUSSER \n und \t
//   - CSI-Sequenzen   (ESC[…[@-~])     — Cursor/Color/Mode-Manipulation
//   - OSC-Sequenzen   (ESC]…BEL|ST)    — Clipboard, Window-Title, Hyperlink
//   - DCS/SOS/PM/APC  (ESC[PXZ\\]_^])  — Device-Control-Strings
//   - Stand-alone ST  (ESC\)
//
// EXPLIZIT erlaubt: \n (newline), \t (tab) — Layout-Whitespace.
// EXPLIZIT NICHT erlaubt: \x1b (ESC), \x07 (BEL), alle anderen Control-Chars.
//
// Ausnahme: src/commands/attach.ts WS-stdout — das ist echter PTY-Passthrough
// von einer User-eigenen VM, ANSI ist by-design. Dort NICHT safe() anwenden.
// Reihenfolge ist wichtig (Alternation-Greedy): laengere ESC-Sequenzen
// ZUERST, dann standalone-ESC, dann uebrige C0-Controls.
// ESC alleine darf NICHT in der ersten Char-Class stehen, sonst frisst
// sie ihn weg bevor die CSI/OSC-Varianten zum Zug kommen.
const ANSI_AND_CONTROL_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b\\|\x1b|[\x00-\x08\x0B-\x1F\x7F]/g;

/**
 * Sanitisiert Server-Strings vor der Terminal-Ausgabe. Entfernt ANSI-
 * Escape-Sequenzen und Control-Characters. Tab und Newline bleiben erhalten.
 *
 * IMMER anwenden auf: Server-Response-Strings, Backend-Error-Details,
 * marked-Output (post-render), userinfo, OAuth-Provider-Messages, Lab-
 * Task-Output, Hint-Texte, Lesson-Titel.
 *
 * NICHT anwenden auf: WS-PTY-Stream in attach.ts (das ist eigene VM).
 */
export function safe(input: unknown, maxLen = 4000): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : String(input);
  const cleaned = s.replace(ANSI_AND_CONTROL_RE, "");
  // Defense-in-depth gegen pathologische Megabyte-Strings vom Backend.
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "…" : cleaned;
}

export const ui = {
  success: (msg: string): void => console.log(chalk.green("✓ ") + msg),
  error: (msg: string): void => console.error(chalk.red("✗ ") + msg),
  warn: (msg: string): void => console.warn(chalk.yellow("⚠ ") + msg),
  info: (msg: string): void => console.log(chalk.cyan("→ ") + msg),
  dim: (msg: string): string => chalk.gray(msg),
  bold: (msg: string): string => chalk.bold(msg),
  blue: (msg: string): string => chalk.blue(msg),
  cyan: (msg: string): string => chalk.cyan(msg),
  green: (msg: string): string => chalk.green(msg),
  yellow: (msg: string): string => chalk.yellow(msg),
  red: (msg: string): string => chalk.red(msg),
  magenta: (msg: string): string => chalk.magenta(msg),
};

export function printHeader(title: string): void {
  const bar = "─".repeat(Math.max(20, Math.min(60, title.length + 4)));
  console.log("");
  console.log(chalk.bold.blue("┌" + bar));
  console.log(chalk.bold.blue("│ ") + chalk.bold(title));
  console.log(chalk.bold.blue("└" + bar));
}

export function printError(err: unknown): void {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const data = err.response?.data as { detail?: string | { message?: string } } | undefined;

    // Backend liefert oft {"detail": "..."} bei 4xx — das ist die menschen-
    // lesbare Message. Wenn detail ein Objekt ist (Validation-Errors),
    // versuchen wir .message; sonst stringify.
    // Alle Werte durch safe() — Server-Strings sind untrusted (ANSI-Schutz).
    let detail: string;
    if (typeof data?.detail === "string") {
      detail = safe(data.detail);
    } else if (data?.detail && typeof data.detail === "object") {
      const obj = data.detail as { message?: string };
      detail = safe(obj.message ?? JSON.stringify(obj));
    } else {
      detail = safe(err.message);
    }

    if (status === 401) {
      ui.error("Nicht angemeldet oder Sitzung abgelaufen.");
      console.log(ui.dim("  → Versuche: ") + chalk.cyan("techlogia login"));
    } else if (status === 403) {
      ui.error(`Zugriff verweigert: ${detail}`);
    } else if (status === 404) {
      ui.error(`Nicht gefunden: ${detail}`);
    } else if (status === 429) {
      ui.error("Zu viele Anfragen — bitte kurz warten.");
    } else if (status && status >= 500) {
      ui.error(`Server-Fehler (${status}): ${detail}`);
      console.log(ui.dim("  → Status prüfen: ") + chalk.cyan("techlogia health"));
    } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      // baseURL koennte env-controlled sein (TECHLOGIA_API). Saniren um
      // sicherzugehen dass kein Angreifer via env-injected ANSI durchkommt.
      ui.error(`API nicht erreichbar (${safe(err.config?.baseURL ?? "?")}).`);
      console.log(ui.dim("  → Internet prüfen oder ") + chalk.cyan("TECHLOGIA_API") + ui.dim(" anpassen."));
    } else {
      ui.error(`API-Fehler ${status ?? ""}: ${detail}`);
    }
    return;
  }

  if (err instanceof Error) {
    // Error-Messages koennen Server-Strings enthalten (z.B. wenn upstream
    // catch + rethrow). Defense-in-depth: safe().
    ui.error(safe(err.message));
    return;
  }

  ui.error(safe(String(err)));
}

export function formatDate(iso?: string | null): string {
  if (!iso) return ui.dim("—");
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDuration(minutes?: number | null): string {
  if (minutes == null) return ui.dim("—");
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h}h ${m}min`;
}

export function formatCents(cents?: number | null, currency = "EUR"): string {
  if (cents == null) return ui.dim("—");
  const euros = (cents / 100).toFixed(2);
  const symbol = currency === "EUR" ? "€" : currency;
  return `${euros} ${symbol}`;
}
