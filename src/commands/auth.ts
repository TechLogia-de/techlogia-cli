import { Command } from "commander";
import prompts from "prompts";
import ora from "ora";
import { api, apiAnon } from "../api/client";
import { clearTokens, saveTokens, storageBackend } from "../api/storage";
import { AuthMeResponse, TokenResponse } from "../api/types";
import { config } from "../config";
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

export const loginCommand = new Command("login")
  .description("Bei Techlogia anmelden (Email + Passwort, MFA-tauglich)")
  .option("-e, --email <email>", "Email-Adresse")
  .option("-p, --password <password>", "Passwort (UNSAFE: nur fuer CI/Test, sonst weglassen)")
  .action(async (opts: { email?: string; password?: string }) => {
    if (opts.password) {
      ui.warn(
        "Passwort als CLI-Flag uebergeben — sichtbar in History/Process-List. Nur fuer CI.",
      );
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
    try {
      // Server-Blacklist ist best-effort — wenn die API down ist, loggen
      // wir trotzdem lokal aus damit der User nicht stuck ist.
      await api.post("/api/auth/logout").catch(() => undefined);
    } finally {
      await clearTokens();
      ui.success("Abgemeldet.");
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
