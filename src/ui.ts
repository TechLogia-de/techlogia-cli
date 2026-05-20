import chalk from "chalk";
import { AxiosError } from "axios";

// chalk@4 ist CJS — bundle-bar. chalk@5 ist ESM-only und wuerde unseren
// CJS-Build sprengen. Falls jemand spaeter migriert: ESM-Migration ist
// non-trivial wegen require()-Aufrufen im Code.

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
    let detail: string;
    if (typeof data?.detail === "string") {
      detail = data.detail;
    } else if (data?.detail && typeof data.detail === "object") {
      detail = (data.detail as { message?: string }).message ?? JSON.stringify(data.detail);
    } else {
      detail = err.message;
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
      console.log(ui.dim("  → Status pruefen: ") + chalk.cyan("techlogia health"));
    } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      ui.error(`API nicht erreichbar (${err.config?.baseURL ?? "?"}).`);
      console.log(ui.dim("  → Internet pruefen oder ") + chalk.cyan("TECHLOGIA_API") + ui.dim(" anpassen."));
    } else {
      ui.error(`API-Fehler ${status ?? ""}: ${detail}`);
    }
    return;
  }

  if (err instanceof Error) {
    ui.error(err.message);
    return;
  }

  ui.error(String(err));
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
