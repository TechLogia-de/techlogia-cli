import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Command } from "commander";
import prompts from "prompts";
import ora from "ora";
import { api, apiAnon } from "../api/client";
import { clearTokens, saveTokens, storageBackend } from "../api/storage";
import { AuthMeResponse, TokenResponse } from "../api/types";
import { config, getApiBaseUrl } from "../config";
import { getPersonaForUser } from "../personas";
import { printError, ui } from "../ui";

// Login-Flow: drei Antwortzweige
// 1) 200 + {access_token,...}     → eingeloggt
// 2) 202 + {mfa_required, mfa_token} → MFA-Code anfordern
// 3) 412 + {detail: "lab_agb_pending"}  → AGB-Annahme noetig (Lab-User)
// 4) 403 + {detail: "oauth_only"} → User kommt von Google/GitHub, Email-Login blockiert
async function performLogin(email: string, password: string): Promise<TokenResponse | null> {
  try {
    const resp = await apiAnon.post<TokenResponse>("/api/auth/login", {
      email,
      password,
    });
    return resp.data;
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: Record<string, unknown> } };
    const status = ax.response?.status;
    const data = ax.response?.data;

    if (status === 202 && data && (data as { mfa_required?: boolean }).mfa_required) {
      const mfaToken = (data as { mfa_token?: string }).mfa_token;
      if (!mfaToken) throw err;

      const { code } = await prompts({
        type: "text",
        name: "code",
        message: "MFA-Code (6 Ziffern)",
        validate: (v: string) => (/^\d{6}$/.test(v) ? true : "Bitte 6 Ziffern eingeben"),
      });
      if (!code) return null;

      const mfaResp = await apiAnon.post<TokenResponse>("/api/auth/login/mfa", {
        mfa_token: mfaToken,
        code,
      });
      return mfaResp.data;
    }

    if (status === 412) {
      // AGB nicht angenommen — Lab-Lerner muss erst zustimmen.
      // Wir zeigen das im Browser an, weil das AGB-PDF im Web pflegbar ist.
      ui.warn("Lab-AGB nicht angenommen. Bitte einmalig im Browser akzeptieren:");
      console.log("  https://techlogia.de/lab/agb");
      return null;
    }

    if (status === 403 && data) {
      const detail = (data as { detail?: string; oauth_provider?: string }).detail;
      const provider = (data as { oauth_provider?: string }).oauth_provider;
      if (provider) {
        ui.error(`Dieses Konto nutzt ${provider}-Login. Email-Passwort funktioniert hier nicht.`);
        ui.info(`Bitte im Browser ueber https://techlogia.de/login einloggen.`);
        return null;
      }
      if (detail) ui.error(detail);
      return null;
    }

    throw err;
  }
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

export interface WebLoginResult {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

/**
 * Browser-Login-Flow (analog `gh auth login --web`, `gcloud auth login`).
 *
 *   1. Start local HTTP listener on 127.0.0.1:RANDOM_PORT.
 *   2. Generate random state (CSRF-Schutz).
 *   3. Open browser to /cli-auth?cli_state=...&cli_redirect=...
 *   4. Frontend: nach Login -> POST /api/auth/cli/init -> Code.
 *   5. Frontend redirected Browser zu localhost:PORT/?code=...&state=...
 *   6. Listener empfaengt, validiert state, POST /api/auth/cli/exchange.
 *   7. Tokens speichern, Server schliessen.
 */
export async function webLogin(): Promise<WebLoginResult> {
  return new Promise<WebLoginResult>((resolve) => {
    const state = crypto.randomBytes(24).toString("base64url");
    const apiBase = getApiBaseUrl();

    let resolved = false;
    const finish = (r: WebLoginResult): void => {
      if (resolved) return;
      resolved = true;
      try {
        server.close();
      } catch {
        // best-effort
      }
      resolve(r);
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/" && url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const stateReturned = url.searchParams.get("state");
      if (!code || !stateReturned) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>Fehler</h1><p>Code oder State fehlt. Bitte Login erneut starten.</p>",
        );
        finish({ ok: false, error: "Code oder State fehlt." });
        return;
      }
      if (stateReturned !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Fehler</h1><p>State-Check fehlgeschlagen.</p>");
        finish({ ok: false, error: "State-Mismatch (CSRF)." });
        return;
      }
      // Code gegen Tokens tauschen
      try {
        const exchange = await apiAnon.post<{ access_token: string; refresh_token: string }>(
          "/api/auth/cli/exchange",
          { code, state },
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Techlogia CLI</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#0F0F0E}
h1{color:#10B981;margin-bottom:12px}p{color:#6B7280;line-height:1.6}</style></head>
<body><h1>Login erfolgreich</h1><p>Du kannst dieses Fenster jetzt schliessen.<br>Geh zurueck zur Techlogia CLI.</p></body></html>`,
        );
        finish({
          ok: true,
          access_token: exchange.data.access_token,
          refresh_token: exchange.data.refresh_token,
        });
      } catch (err) {
        const e = err as { response?: { data?: { detail?: string } } };
        const detail = e?.response?.data?.detail ?? "Exchange fehlgeschlagen.";
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Fehler</h1><p>${detail}</p>`);
        finish({ ok: false, error: detail });
      }
    });

    // listen(0) = OS sucht freien Port
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const cliRedirect = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${apiBase}/cli-auth?cli_state=${encodeURIComponent(state)}&cli_redirect=${encodeURIComponent(cliRedirect)}`;
      console.log("");
      console.log(ui.dim("  Oeffne Browser zur Login-Seite..."));
      console.log(ui.dim("  Falls nichts passiert, kopiere diese URL:"));
      console.log("  " + ui.cyan(authUrl));
      console.log("");
      openBrowser(authUrl);
    });

    server.on("error", (err) => {
      finish({ ok: false, error: `HTTP-Listener-Fehler: ${err.message}` });
    });

    // Timeout 5 Minuten — falls User Browser-Tab schliesst ohne Login
    setTimeout(
      () => finish({ ok: false, error: "Timeout (5 Min) — Login nicht abgeschlossen." }),
      5 * 60 * 1000,
    );
  });
}

export const loginCommand = new Command("login")
  .description("Bei Techlogia anmelden — per Browser (default) oder Email/Passwort")
  .option("-e, --email <email>", "Email-Adresse (Terminal-Login statt Browser)")
  .option("-p, --password <password>", "Passwort (UNSAFE: nur fuer CI/Test, sonst weglassen)")
  .option("--web", "Browser-Login erzwingen (Default wenn keine --email/--password angegeben)")
  .option("--terminal", "Email/Passwort im Terminal statt Browser")
  .action(async (opts: { email?: string; password?: string; web?: boolean; terminal?: boolean }) => {
    if (opts.password) {
      ui.warn(
        "Passwort als CLI-Flag uebergeben — sichtbar in History/Process-List. Nur fuer CI.",
      );
    }

    // Browser-Flow ist Default, AUSSER --terminal explizit oder Email+Passwort
    // bereits als Flag uebergeben (CI-Pattern).
    const useWeb =
      opts.web === true ||
      (!opts.terminal && !opts.email && !opts.password);

    if (useWeb) {
      ui.info("Starte Browser-Login...");
      const result = await webLogin();
      if (!result.ok) {
        ui.error(result.error ?? "Login fehlgeschlagen.");
        return;
      }
      if (!result.access_token || !result.refresh_token) {
        ui.error("Tokens fehlen in der Antwort.");
        return;
      }
      await saveTokens(result.access_token, result.refresh_token);
      try {
        const me = (await api.get<AuthMeResponse>("/api/auth/me")).data;
        const persona = getPersonaForUser(me);
        config.set("lastEmail", me.email);
        console.log("");
        ui.success(`Angemeldet als ${ui.bold(me.display_name || me.username || me.email)}`);
        console.log(`  Rolle: ${ui.cyan(persona.label)} — ${ui.dim(persona.description)}`);
        console.log(`  Token-Speicher: ${ui.dim(storageBackend())}`);
      } catch {
        ui.success("Angemeldet. (Profil-Abruf fehlgeschlagen, Tokens trotzdem gespeichert.)");
      }
      return;
    }

    const lastEmail = config.get("lastEmail");
    const responses = await prompts([
      {
        type: opts.email ? null : "text",
        name: "email",
        message: "Email",
        initial: lastEmail,
        validate: (v: string) => (v.includes("@") ? true : "Bitte gueltige Email"),
      },
      {
        type: opts.password ? null : "password",
        name: "password",
        message: "Passwort",
        validate: (v: string) => (v.length >= 1 ? true : "Pflichtfeld"),
      },
    ]);

    const email = opts.email ?? responses.email;
    const password = opts.password ?? responses.password;
    if (!email || !password) {
      ui.warn("Abgebrochen.");
      return;
    }

    const spinner = ora("Anmeldung laeuft...").start();
    try {
      const result = await performLogin(email, password);
      spinner.stop();
      if (!result) return;

      await saveTokens(result.access_token, result.refresh_token);
      config.set("lastEmail", email);

      // Persona-Info direkt nach Login zeigen — User soll wissen wozu er
      // jetzt Zugriff hat (zentrales UX-Element der Persona-CLI).
      const me = result.user ?? (await api.get<AuthMeResponse>("/api/auth/me")).data;
      const persona = getPersonaForUser(me);

      ui.success(`Angemeldet als ${ui.bold(me.display_name || me.username || me.email)}`);
      console.log(`  Rolle: ${ui.cyan(persona.label)} — ${ui.dim(persona.description)}`);
      console.log(`  Token-Speicher: ${ui.dim(storageBackend())}`);
      console.log("");
      console.log(ui.dim("Tipp: `techlogia` ohne Argumente zeigt dir alle verfuegbaren Befehle."));
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

export const logoutCommand = new Command("logout")
  .description("Lokale Sitzung beenden + Refresh-Token serverseitig blacklisten")
  .action(async () => {
    // Server-Blacklist ist best-effort — wenn die API down ist, loggen
    // wir trotzdem lokal aus damit der User nicht stuck ist. Wir tracken
    // aber ob das Server-Logout erfolgreich war, damit User informiert
    // wird falls der Token serverseitig noch gueltig bleibt.
    let serverLogoutOk = false;
    try {
      await api.post("/api/auth/logout");
      serverLogoutOk = true;
    } catch {
      serverLogoutOk = false;
    }
    await clearTokens();
    if (serverLogoutOk) {
      ui.success("Abgemeldet.");
    } else {
      ui.success("Lokal abgemeldet.");
      ui.warn(
        "Server-Logout fehlgeschlagen — Token bleibt bis zum natuerlichen Ablauf "
          + "(Access ~24h, Refresh ~7 Tage) serverseitig gueltig. "
          + "Im Zweifel: kompromittiertes Geraet abschalten.",
      );
    }
  });

export const whoamiCommand = new Command("whoami")
  .description("Eingeloggte Identitaet + Persona anzeigen")
  .action(async () => {
    try {
      const me = (await api.get<AuthMeResponse>("/api/auth/me")).data;
      const persona = getPersonaForUser(me);

      console.log("");
      console.log(`${ui.bold("Identitaet")}`);
      console.log(`  Email     : ${me.email}`);
      console.log(`  Benutzer  : ${me.username}`);
      if (me.display_name) console.log(`  Anzeigename: ${me.display_name}`);
      console.log(`  Rolle     : ${ui.cyan(persona.label)} (${me.role})`);
      console.log(`  Persona   : ${ui.dim(persona.description)}`);
      if (me.xp_total != null) {
        const level = Math.floor(Math.sqrt(me.xp_total / 100));
        console.log(`  XP        : ${me.xp_total} (Level ${level})`);
      }
      if (me.student_class_id) {
        console.log(`  Klasse    : #${me.student_class_id} (Schueler-Login)`);
      }
      if (me.suspended_at) {
        console.log(`  ${ui.red("Konto gesperrt seit:")} ${me.suspended_at}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
