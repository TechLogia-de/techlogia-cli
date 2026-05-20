import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { getApiBaseUrl } from "../config";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./storage";
import { TokenResponse } from "./types";

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
// Mobile-Block-Bypass) triggert die fuer CLI nicht gilt.
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
      const resp = await axios.post<TokenResponse>(
        `${getApiBaseUrl()}/api/auth/refresh`,
        { refresh_token: refresh },
        { headers: { "User-Agent": USER_AGENT } },
      );
      const { access_token, refresh_token } = resp.data;
      await saveTokens(access_token, refresh_token);
      return access_token;
    } catch {
      // Refresh-Token abgelaufen oder revoked — User muss erneut login'en.
      // Wir loeschen die Tokens damit der naechste Aufruf nicht in einem
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

// Convenience-Default fuer simple calls — getrennte Instance damit der
// 401-Refresh-Interceptor pro Aufruf einmal sauber arbeitet.
export const api = createClient();
export const apiAnon = createClient({ auth: false });
