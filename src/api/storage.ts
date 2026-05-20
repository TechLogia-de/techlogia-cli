import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// JWT-Storage mit OS-Keychain (keytar) als Primary, File-Fallback fuer
// Systeme ohne libsecret (Linux-Server ohne GUI, Container, CI).
//
// WARUM Fallback: keytar ist eine native Dep — required() crasht auf
// Linux ohne libsecret-1-dev. Der CLI darf das nicht das Genick brechen,
// also Lazy-Import + try/catch + Plain-File mit chmod 600.

const SERVICE = "techlogia-cli";
const ACCOUNT_ACCESS = "access_token";
const ACCOUNT_REFRESH = "refresh_token";

const FALLBACK_DIR = path.join(os.homedir(), ".techlogia");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "tokens.json");

type Keytar = {
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

let keytarCache: Keytar | null | undefined;

function loadKeytar(): Keytar | null {
  if (keytarCache !== undefined) return keytarCache;
  try {
    // Optional-Dep — kann fehlen oder native-load-fail werfen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    keytarCache = require("keytar") as Keytar;
  } catch {
    keytarCache = null;
  }
  return keytarCache;
}

type TokenFile = { access_token?: string; refresh_token?: string };

function readFallback(): TokenFile {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return {};
    return JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf-8")) as TokenFile;
  } catch {
    return {};
  }
}

function writeFallback(data: TokenFile): void {
  // chmod 700 auf Dir + 600 auf File — Tokens nie world-readable lassen.
  // Wenn ein anderer User auf der Maschine sitzt, soll er sie nicht
  // einfach via ls -la /Users/X/.techlogia/ einsehen koennen.
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE, ACCOUNT_ACCESS, accessToken);
    await keytar.setPassword(SERVICE, ACCOUNT_REFRESH, refreshToken);
    return;
  }
  writeFallback({ access_token: accessToken, refresh_token: refreshToken });
}

export async function getAccessToken(): Promise<string | null> {
  const keytar = loadKeytar();
  if (keytar) {
    return await keytar.getPassword(SERVICE, ACCOUNT_ACCESS);
  }
  return readFallback().access_token ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const keytar = loadKeytar();
  if (keytar) {
    return await keytar.getPassword(SERVICE, ACCOUNT_REFRESH);
  }
  return readFallback().refresh_token ?? null;
}

export async function clearTokens(): Promise<void> {
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE, ACCOUNT_ACCESS).catch(() => false);
    await keytar.deletePassword(SERVICE, ACCOUNT_REFRESH).catch(() => false);
    return;
  }
  try {
    if (fs.existsSync(FALLBACK_FILE)) fs.unlinkSync(FALLBACK_FILE);
  } catch {
    // ignorieren — wenn das File nicht weg geht ist es kein Fehler den User
    // sehen muss; die naechste login-Aktion ueberschreibt es ohnehin.
  }
}

export function storageBackend(): "keychain" | "file" {
  return loadKeytar() ? "keychain" : "file";
}
