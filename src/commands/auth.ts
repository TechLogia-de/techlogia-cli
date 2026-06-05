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
import { printError, safe, ui } from "../ui";

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
        ui.info(`Bitte im Browser über https://techlogia.de/login einloggen.`);
        return null;
      }
      if (detail) ui.error(detail);
      return null;
    }

    throw err;
  }
}

function openBrowser(url: string): void {
  // SECURITY (P7, 2026-05-23): URL kommt ueber getApiBaseUrl() aus der
  // TECHLOGIA_API env-var. Validieren bevor wir an spawn() weiterreichen:
  //   - Muss gueltige URL sein (URL-Constructor wirft sonst)
  //   - Schema nur http/https (kein file://, javascript:, data:)
  //   - Hostname auf bekannte Werte beschraenken — Ausnahme wenn explizit
  //     ein eigener TECHLOGIA_API gesetzt ist (Dev-Workflow).
  const u = new URL(url); // wirft bei ungueltiger URL
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`openBrowser: unzulaessiges Schema ${u.protocol}`);
  }
  const allowedHosts = new Set(["techlogia.de", "127.0.0.1", "localhost"]);
  if (!allowedHosts.has(u.hostname) && !process.env.TECHLOGIA_API) {
    throw new Error(`openBrowser: nicht erlaubter Host ${u.hostname}`);
  }
  // Windows-Sonderfall (Audit HIGH-3, 2026-06-05): "start" ist ein
  // cmd.exe-Builtin, KEIN Executable — spawn("start", ...) wirft ENOENT
  // und crasht den Login. Deshalb cmd /c start. windowsVerbatimArguments
  // + manuelle Quotes sind Pflicht, weil cmd.exe sonst & = ? in der URL
  // als Metazeichen parst (Command-Injection-Vektor, wenn TECHLOGIA_API
  // attacker-controlled ist). Literale `"` kann eine valide URL nicht
  // enthalten (immer %22-encoded) — das Quoting ist also nicht brechbar.
  // Das leere "" davor ist der Fenstertitel-Platzhalter von `start`.
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", '""', `"${url}"`], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    }).unref();
    return;
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
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
 *   7. Tokens speichern, Server schließen.
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

    // PKCE S256 (P5, 2026-05-23, RFC 7636) — schuetzt Authorization-Code
    // vor Interception/Replay (geleakte Logs, Insider mit DB-Zugriff). state
    // allein deckt nur CSRF ab, nicht Code-Theft. Verifier 43-128 Zeichen
    // base64url, Challenge ist SHA-256 base64url. Wird mit /api/auth/cli/init
    // mitgeschickt (gespeichert beim Backend gegen den Authorization-Code)
    // und mit /api/auth/cli/exchange verifiziert.
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // Defensive security headers fuer die HTML-Response (P2).
    // CSP default-src 'none' verhindert dass eine kompromittierte Page
    // irgendwelche Subresources nachzieht. Stylesheet via 'unsafe-inline'
    // weil der CSS-Block direkt im HTML steht (kein externer Loader).
    const secureHtmlHeaders = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    } as const;

    const server = http.createServer(async (req, res) => {
      // SECURITY-HÄRTUNG (P2, 2026-05-23, ab hier vier neue Checks):
      // a) Nur GET — Browser-Redirect kommt immer GET.
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      // b) DNS-Rebinding-Schutz: Host-Header MUSS 127.0.0.1/localhost sein.
      //    Verhindert dass eine bose Webseite via dns-rebinding den Browser
      //    dazu bringt, GET 127.0.0.1:PORT?code=... mit anderem Host-Header
      //    abzusenden und so den OAuth-Code zu klauen.
      const hostHeader = req.headers.host ?? "";
      if (
        !hostHeader.startsWith("127.0.0.1:") &&
        !hostHeader.startsWith("localhost:")
      ) {
        res.writeHead(421, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      // c) Nur lokale Verbindungen — paranoid weil server.listen("127.0.0.1")
      //    bereits bindet, aber Node liefert manchmal ::ffff:127.0.0.1.
      const remote = req.socket.remoteAddress;
      if (
        remote !== "127.0.0.1" &&
        remote !== "::ffff:127.0.0.1" &&
        remote !== "::1"
      ) {
        res.writeHead(403, { "Cache-Control": "no-store" });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // d) Nur /callback — alles andere ist Probe-Traffic.
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const stateReturned = url.searchParams.get("state");
      if (!code || !stateReturned) {
        res.writeHead(400, secureHtmlHeaders);
        res.end(
          "<!doctype html><meta charset='utf-8'><title>Fehler</title><h1>Fehler</h1><p>Code oder State fehlt. Bitte Login erneut starten.</p>",
        );
        finish({ ok: false, error: "Code oder State fehlt." });
        return;
      }
      // SECURITY (P2): timing-safe Vergleich statt === — verhindert
      // Timing-Side-Channel (Angreifer koennte State per Charakter erraten).
      const a = Buffer.from(stateReturned);
      const b = Buffer.from(state);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.writeHead(400, secureHtmlHeaders);
        res.end(
          "<!doctype html><meta charset='utf-8'><title>Fehler</title><h1>Fehler</h1><p>State-Check fehlgeschlagen.</p>",
        );
        finish({ ok: false, error: "State-Mismatch (CSRF)." });
        return;
      }
      // Code gegen Tokens tauschen — mit code_verifier fuer PKCE.
      try {
        const exchange = await apiAnon.post<{ access_token: string; refresh_token: string }>(
          "/api/auth/cli/exchange",
          { code, state, code_verifier: codeVerifier },
        );
        res.writeHead(200, secureHtmlHeaders);
        res.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Techlogia CLI</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#0F0F0E}
h1{color:#10B981;margin-bottom:12px}p{color:#6B7280;line-height:1.6}</style></head>
<body><h1>Login erfolgreich</h1><p>Du kannst dieses Fenster jetzt schließen.<br>Geh zurück zur Techlogia CLI.</p></body></html>`,
        );
        finish({
          ok: true,
          access_token: exchange.data.access_token,
          refresh_token: exchange.data.refresh_token,
        });
      } catch (err) {
        const e = err as { response?: { data?: { detail?: string } } };
        // Server-Errors duerfen nicht ungefiltert ins HTML — koennten
        // ANSI/HTML enthalten. safe() + HTML-escape.
        const rawDetail = e?.response?.data?.detail ?? "Exchange fehlgeschlagen.";
        const detail = safe(rawDetail)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        res.writeHead(500, secureHtmlHeaders);
        res.end(
          `<!doctype html><meta charset='utf-8'><title>Fehler</title><h1>Fehler</h1><p>${detail}</p>`,
        );
        finish({ ok: false, error: safe(rawDetail) });
      }
    });

    // listen(0) = OS sucht freien Port
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const cliRedirect = `http://127.0.0.1:${port}/callback`;
      // PKCE: code_challenge an /cli-auth weiterreichen, dort sendet der
      // Frontend den Authorize-Init mit Challenge an /api/auth/cli/init.
      // Backend speichert Challenge gegen den ausgegebenen Authorization-
      // Code und vergleicht beim Exchange.
      const authUrl =
        `${apiBase}/cli-auth?cli_state=${encodeURIComponent(state)}` +
        `&cli_redirect=${encodeURIComponent(cliRedirect)}` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256`;
      console.log("");
      console.log(ui.dim("  Oeffne Browser zur Login-Seite..."));
      console.log(ui.dim("  Falls nichts passiert, kopiere diese URL:"));
      console.log("  " + ui.cyan(authUrl));
      console.log("");
      try {
        openBrowser(authUrl);
      } catch (browserErr) {
        // openBrowser kann jetzt werfen (URL-Validierung). Logge die
        // Ursache aber breche Login nicht ab — User kann URL manuell oeffnen.
        const msg = browserErr instanceof Error ? browserErr.message : String(browserErr);
        ui.warn(`Browser-Auto-Open fehlgeschlagen: ${safe(msg)}`);
        console.log(ui.dim("  → Bitte obige URL manuell im Browser oeffnen."));
      }
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
  .option("-p, --password <password>", "Passwort (UNSAFE: nur für CI/Test, sonst weglassen)")
  .option("--web", "Browser-Login erzwingen (Default wenn keine --email/--password angegeben)")
  .option("--terminal", "Email/Passwort im Terminal statt Browser")
  .action(async (opts: { email?: string; password?: string; web?: boolean; terminal?: boolean }) => {
    if (opts.password) {
      ui.warn(
        "Passwort als CLI-Flag übergeben — sichtbar in History/Process-List. Nur für CI.",
      );
    }

    // Browser-Flow ist Default, AUSSER --terminal explizit oder Email+Passwort
    // bereits als Flag übergeben (CI-Pattern).
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
        validate: (v: string) => (v.includes("@") ? true : "Bitte gültige Email"),
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

    const spinner = ora("Anmeldung läuft...").start();
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
      console.log(ui.dim("Tipp: `techlogia` ohne Argumente zeigt dir alle verfügbaren Befehle."));
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
    // wird falls der Token serverseitig noch gültig bleibt.
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
          + "(Access ~24h, Refresh ~7 Tage) serverseitig gültig. "
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
        console.log(`  Klasse    : #${me.student_class_id} (Schüler-Login)`);
      }
      if (me.suspended_at) {
        console.log(`  ${ui.red("Konto gesperrt seit:")} ${me.suspended_at}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
