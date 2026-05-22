import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// JWT-Storage mit OS-Keychain (keytar) als Primary, AES-GCM-File-Fallback
// für Systeme ohne libsecret (Linux-Server ohne GUI, Container, CI).
//
// WARUM Fallback: keytar ist eine native Dep — required() crasht auf
// Linux ohne libsecret-1-dev. Der CLI darf das nicht das Genick brechen,
// also Lazy-Import + try/catch + verschluesseltes File mit chmod 600.
//
// SECURITY P4 (2026-05-23): Fallback nutzt AES-256-GCM mit machine-
// derived Key (hostname + uid). Defense-in-depth gegen:
//   - Backup-Sync (iCloud, Dropbox, Time Machine) → File ist nutzlos
//     auf anderer Maschine, weil Key nicht uebertragen wird
//   - Git/Repo-Leak → Tokens nicht plain lesbar
//   - Multi-User-Server → andere User ohne Maschinen-Identitaet kriegen
//     den Key nicht hergeleitet
//
// NICHT Schutz gegen: denselben User auf derselben Maschine — der kann
// hostname + uid + product-string nachbauen und entschluesseln. Fuer
// echten Schutz dagegen waere OS-Keychain noetig (keytar-Pfad).

const SERVICE = "techlogia-cli";
const ACCOUNT_ACCESS = "access_token";
const ACCOUNT_REFRESH = "refresh_token";

const FALLBACK_DIR = path.join(os.homedir(), ".techlogia");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "tokens.json");
// Encrypted-File-Variante — wenn beides existiert (Migration), gewinnt
// das encrypted-File. Plain-File wird beim ersten Read geloescht.
const FALLBACK_FILE_ENC = path.join(FALLBACK_DIR, "tokens.enc");

// Schluessel-Ableitung: SHA-256(hostname || uid || product-string).
// Deterministisch pro (Maschine, User, Produkt) — gleicher User auf
// gleicher Maschine bekommt immer denselben Key zurueck.
function deriveMachineKey(): Buffer {
  const uid = typeof os.userInfo === "function"
    ? String(os.userInfo().uid ?? "0")
    : "0";
  const seed = `${os.hostname()}|${uid}|techlogia-cli|v1`;
  return crypto.createHash("sha256").update(seed).digest();
}

// AES-256-GCM: 12-Byte-IV pro Encryption (random), 16-Byte-AuthTag (default).
// Format: base64( iv || tag || ciphertext ).
function encryptValue(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveMachineKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptValue(blob: string): string | null {
  try {
    const buf = Buffer.from(blob, "base64");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveMachineKey(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString("utf8");
  } catch {
    // AuthTag-Mismatch -> Tampering oder anderer Schluessel (z.B. Backup-
    // restore auf anderer Maschine). Token ist nicht nutzbar.
    return null;
  }
}

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
type EncryptedTokenFile = { v: 1; access_token?: string; refresh_token?: string };

function readFallback(): TokenFile {
  // 1) Verschluesselte Variante bevorzugen (neue Tokens).
  try {
    if (fs.existsSync(FALLBACK_FILE_ENC)) {
      const raw = fs.readFileSync(FALLBACK_FILE_ENC, "utf-8");
      const parsed = JSON.parse(raw) as EncryptedTokenFile;
      if (parsed.v !== 1) return {};
      const out: TokenFile = {};
      if (parsed.access_token) {
        const dec = decryptValue(parsed.access_token);
        if (dec) out.access_token = dec;
      }
      if (parsed.refresh_token) {
        const dec = decryptValue(parsed.refresh_token);
        if (dec) out.refresh_token = dec;
      }
      return out;
    }
  } catch {
    // Fall through zur Plain-Variante.
  }
  // 2) Migrations-Pfad: alte Plain-Tokens lesen, beim naechsten Write
  // automatisch in encrypted form gespeichert + Plain-File geloescht.
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
  // einfach via ls -la /Users/X/.techlogia/ einsehen können.
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  }
  const enc: EncryptedTokenFile = { v: 1 };
  if (data.access_token) enc.access_token = encryptValue(data.access_token);
  if (data.refresh_token) enc.refresh_token = encryptValue(data.refresh_token);
  // Atomic-Write: erst .tmp schreiben, dann rename — verhindert kaputten
  // File-Zustand bei Stromausfall mitten im Write.
  const tmp = FALLBACK_FILE_ENC + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(enc), { mode: 0o600 });
  fs.renameSync(tmp, FALLBACK_FILE_ENC);
  // Migrations-Cleanup: Plain-File loeschen falls noch da (alte Version).
  try {
    if (fs.existsSync(FALLBACK_FILE)) fs.unlinkSync(FALLBACK_FILE);
  } catch {
    // Plain-File-Cleanup best-effort — nicht kritisch.
  }
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
  // Beide Files loeschen — encrypted (neu) + plain (Migration-Reste).
  for (const f of [FALLBACK_FILE_ENC, FALLBACK_FILE]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignorieren — wenn das File nicht weg geht ist es kein Fehler den User
      // sehen muss; die nächste login-Aktion überschreibt es ohnehin.
    }
  }
}

export function storageBackend(): "keychain" | "file-encrypted" {
  return loadKeytar() ? "keychain" : "file-encrypted";
}
