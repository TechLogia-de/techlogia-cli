import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { getApiBaseUrl } from "../config";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./storage";
import { TokenResponse } from "./types";
import { assertSafeApiBaseUrl, warnIfNonDefaultHost } from "./url-guard";

// CLI-Version aus package.json — wird vom Bundler inline'd dank tsup
// (CommonJS require resolved at build time). Wir lesen NICHT zur Laufzeit,
// weil der gebuendelte single-file-Build die package.json nicht mehr neben
// sich hat.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../../package.json") as { version: string };
export const CLI_VERSION = pkg.version;

const PLATFORM = `${process.platform}-${process.arch}`;
// User-Agent identifiziert die CLI eindeutig — analog zur Flutter-App
// (CLAUDE.md "Mobile-App-Kopplung"). Wir luegen NICHT als "TechlogiaApp/",
// weil das Backend ggf. App-spezifische Logik (Force-Update-Header,
// Mobile-Block-Bypass) triggert die für CLI nicht gilt.
export const USER_AGENT = `TechlogiaCLI/${CLI_VERSION} (${PLATFORM}; node-${process.version})`;

interface ApiClientOptions {
  auth?: boolean;
}

// Singleton-Refresh-Promise — wenn 3 parallele Requests gleichzeitig 401
// kriegen, wollen wir EINEN Refresh-Call machen, nicht drei. Sonst rotiert
// das Backend den Refresh-Token (Token-Rotation in auth.py) und 2 von 3
// Requests gehen mit altem Token raus, 401-Loop.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refresh = await getRefreshToken();
    if (!refresh) return null;
    try {
      // Der Refresh-Token ist das wertvollste Secret der CLI — vor dem rohen
      // axios.post (umgeht die Instance-Interceptor) die Basis-URL prüfen,
      // damit er nie an einen http-/Fremd-Host geht.
      assertSafeApiBaseUrl(getApiBaseUrl());
      const resp = await axios.post<TokenResponse>(
        `${getApiBaseUrl()}/api/auth/refresh`,
        { refresh_token: refresh },
        // maxRedirects 0 wie in createClient — der Refresh-Token ist das
        // wertvollste Secret der CLI, darf nie einem Redirect folgen.
        { headers: { "User-Agent": USER_AGENT }, maxRedirects: 0 },
      );
      const { access_token, refresh_token } = resp.data;
      await saveTokens(access_token, refresh_token);
      return access_token;
    } catch {
      // Refresh-Token abgelaufen oder revoked — User muss erneut login'en.
      // Wir löschen die Tokens damit der nächste Aufruf nicht in einem
      // 401-Refresh-401-Loop haengt.
      await clearTokens();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function createClient(opts: ApiClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 30000,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    // 4xx propagieren wir als Exception (default), 5xx ebenfalls.
    // Wir handhaben sie zentral im Error-Renderer.
    validateStatus: (s) => s >= 200 && s < 300,
    // Keine stillen Redirects (Audit HIGH-2, 2026-06-05): unsere API
    // redirected nie — ein Redirect heisst Fehlkonfiguration oder Angriff
    // (DNS-Hijack koennte den Bearer-Token zu fremdem Host umleiten).
    // Lieber laut fehlschlagen als Token leaken. Beim Zurueckbauen pruefen:
    // FastAPI-Trailing-Slash-307s wuerden dann wieder still durchlaufen.
    maxRedirects: 0,
  });

  // Guard VOR jeder Anfrage (auch anonyme): kein Request/Token an eine
  // http-Nicht-Loopback- oder ungültige URL. Läuft pro Request (nicht bei
  // Modul-Load), crasht also nicht `techlogia --help`. Wirft → das
  // Command-try/catch rendert die Meldung.
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    assertSafeApiBaseUrl(getApiBaseUrl());
    warnIfNonDefaultHost(getApiBaseUrl());
    return config;
  });

  if (opts.auth !== false) {
    instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      const token = await getAccessToken();
      if (token) {
        config.headers.set("Authorization", `Bearer ${token}`);
      }
      return config;
    });

    instance.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        // Nur 401 mit Refresh-Pfad behandeln — andere Status durchreichen.
        // Wenn der Refresh-Endpoint SELBST 401 wirft, retry nicht (sonst loop).
        const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
        if (
          error.response?.status === 401 &&
          !original._retried &&
          !original.url?.includes("/auth/refresh") &&
          !original.url?.includes("/auth/login")
        ) {
          original._retried = true;
          const newToken = await refreshAccessToken();
          if (newToken) {
            original.headers.set("Authorization", `Bearer ${newToken}`);
            return instance.request(original);
          }
        }
        return Promise.reject(error);
      },
    );
  }

  return instance;
}

// Convenience-Default für simple calls — getrennte Instance damit der
// 401-Refresh-Interceptor pro Aufruf einmal sauber arbeitet.
export const api = createClient();
export const apiAnon = createClient({ auth: false });
