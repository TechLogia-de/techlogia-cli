import { safe, ui } from "../ui";

// Zentraler Schutz gegen Token-Exfiltration über eine manipulierte API-Basis-URL
// (SECURITY 2026-07-13). Der WS-Terminal-Pfad (attach.ts) lehnte http:// zu
// Nicht-Loopback schon ab ("Audit HIGH-4"); der REST-Client hängte den Bearer
// aber an JEDE getApiBaseUrl()-URL aus der TECHLOGIA_API env-var — auch
// http://angreifer oder https://fremder-host. Diese Regel gilt jetzt für BEIDE
// Pfade zentral hier.

const DEFAULT_HOST = "techlogia.de";

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

// Wirft, wenn die Basis-URL Tokens im Klartext übertragen würde (http:// zu
// einem Nicht-Loopback-Host) oder ein anderes Schema als http/https nutzt.
// http://localhost bleibt für lokales Dev erlaubt.
export function assertSafeApiBaseUrl(baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(
      `API-URL ist ungültig: "${safe(baseUrl, 80)}" — TECHLOGIA_API prüfen.`,
    );
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(
      `API-URL hat ein unzulässiges Schema (${safe(u.protocol)}) — nur http/https erlaubt.`,
    );
  }
  if (u.protocol !== "https:" && !isLoopbackHost(u.hostname)) {
    throw new Error(
      `API-URL nutzt http:// (unverschlüsselt) zu "${safe(u.hostname)}" — dein Token würde ` +
        `im Klartext übertragen. Bitte https:// verwenden (nur localhost darf http).`,
    );
  }
}

let warnedNonDefault = false;

// Einmalige, laute Warnung auf stderr, wenn gegen einen anderen Host als
// techlogia.de gearbeitet wird. Wirft NICHT — Staging/Dev via TECHLOGIA_API
// ist legitim; der Nutzer soll es nur bewusst mitbekommen, bevor Tokens dort
// landen (auffällig gemachte Umleitung). Loopback wird nicht gewarnt (klar Dev).
export function warnIfNonDefaultHost(baseUrl: string): void {
  if (warnedNonDefault) return;
  try {
    const u = new URL(baseUrl);
    if (u.hostname !== DEFAULT_HOST && !isLoopbackHost(u.hostname)) {
      warnedNonDefault = true;
      ui.warn(
        `API-Host ist "${safe(u.hostname)}" (nicht ${DEFAULT_HOST}). ` +
          `Nur fortfahren, wenn du diese Adresse bewusst gesetzt hast.`,
      );
    }
  } catch {
    // Ungültige URLs behandelt assertSafeApiBaseUrl (wirft dort).
  }
}

// Nur für Tests: Warn-Dedup zurücksetzen.
export function _resetHostWarning(): void {
  warnedNonDefault = false;
}
