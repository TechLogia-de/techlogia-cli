import readline from "node:readline";
import prompts from "prompts";
import { Command } from "commander";
import { parse as shellParse } from "shell-quote";
import { api, apiAnon, CLI_VERSION } from "./api/client";
import { clearTokens, getAccessToken, saveTokens } from "./api/storage";
import { AuthMeResponse, LabSession, sessionId, TokenResponse } from "./api/types";
import { config } from "./config";
import { getPersonaForUser, Persona } from "./personas";
import { ui } from "./ui";
import { attachToSession, renderAttachResult } from "./commands/attach";
import { webLogin } from "./commands/auth";
import { buildPrompt as buildModernPrompt, renderHelpBox, renderWelcome } from "./banner";

// `techlogia shell` — interaktiver REPL-Mode mit:
//   - Slash-Prefix-Commands: /login, /logout, /help, /exit (optional)
//   - `techlogia X` in der Shell wird zu `X` (Prefix-Strip, damit User die
//     externe Aufruf-Syntax nicht extra lernen muss)
//   - Login/Logout MUTIEREN den Shell-State live — Prompt + Persona
//     refreshen sofort, kein Neustart noetig
//   - Anonyme Shell ist erlaubt: man kann `techlogia` ohne Login starten,
//     dann zeigt der Welcome-Block "Gast" und der Prompt forderts auf zu
//     login'en.

interface ShellState {
  me: AuthMeResponse | null;
  persona: Persona;
  activeSession: LabSession | null;
}

interface ShellContext {
  program: Command;
  state: ShellState;
  rl: readline.Interface;
  attachCurrentSession: () => Promise<void>;
  refreshActiveSession: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
  refreshPrompt: () => void;
}

function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}

async function loadMe(): Promise<AuthMeResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return (await api.get<AuthMeResponse>("/api/auth/me")).data;
  } catch {
    return null;
  }
}

async function loadActiveSession(): Promise<LabSession | null> {
  try {
    const resp = await api.get<LabSession | null>("/api/lab/sessions/active");
    return resp.data ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────── Built-in handlers ───────────────────────────

async function handleLogin(ctx: ShellContext): Promise<void> {
  if (ctx.state.me) {
    ui.warn(`Du bist bereits eingeloggt als ${ctx.state.me.email}. Erst /logout.`);
    return;
  }

  ui.info("Browser-Login startet — Tab oeffnet sich automatisch.");
  ctx.rl.pause();
  const result = await webLogin();
  ctx.rl.resume();

  if (!result.ok) {
    ui.error(result.error ?? "Login fehlgeschlagen.");
    return;
  }
  if (!result.access_token || !result.refresh_token) {
    ui.error("Tokens fehlen in der Antwort.");
    return;
  }
  await saveTokens(result.access_token, result.refresh_token);
  await ctx.refreshIdentity();
  await ctx.refreshActiveSession();
  ctx.refreshPrompt();
  const m = ctx.state.me as AuthMeResponse | null;
  if (m) {
    config.set("lastEmail", m.email);
    ui.success(`Angemeldet als ${m.display_name || m.email}.`);
  }
}

async function handleStudentLogin(ctx: ShellContext): Promise<void> {
  if (ctx.state.me) {
    ui.warn(`Du bist bereits eingeloggt als ${ctx.state.me.email}. Erst /logout.`);
    return;
  }
  ctx.rl.pause();
  const answers = await prompts([
    { type: "text", name: "code", message: "Klassen-Code", validate: (v: string) => (v.length >= 4 ? true : "min. 4 Zeichen") },
    { type: "text", name: "name", message: "Dein Login-Name", validate: (v: string) => (v.length >= 2 ? true : "min. 2 Zeichen") },
  ]);
  ctx.rl.resume();
  if (!answers.code || !answers.name) {
    ui.warn("Abgebrochen.");
    return;
  }
  try {
    const resp = await apiAnon.post<TokenResponse>("/api/auth/student/login", {
      class_code: answers.code,
      student_login_name: answers.name,
    });
    await saveTokens(resp.data.access_token, resp.data.refresh_token);
    await ctx.refreshIdentity();
    await ctx.refreshActiveSession();
    ctx.refreshPrompt();
    ui.success(`Hallo ${answers.name}!`);
  } catch {
    ui.error("Schüler-Login fehlgeschlagen — Code oder Name prüfen.");
  }
}

async function handleLogout(ctx: ShellContext): Promise<void> {
  if (!ctx.state.me) {
    ui.info("Du warst nicht eingeloggt.");
    return;
  }
  try {
    await api.post("/api/auth/logout").catch(() => undefined);
  } finally {
    await clearTokens();
  }
  ctx.state.me = null;
  ctx.state.persona = getPersonaForUser(null);
  ctx.state.activeSession = null;
  ctx.refreshPrompt();
  ui.success("Abgemeldet.");
  console.log(ui.dim("  Tipp: /login um wieder einzusteigen — oder /exit zum Verlassen."));
}

// ─────────────────────────── Main dispatch ───────────────────────────

async function runOnce(rawLine: string, ctx: ShellContext): Promise<{ exit: boolean }> {
  let line = rawLine.trim();
  if (!line) return { exit: false };

  // Slash-Prefix optional — /login ist aequivalent zu login.
  if (line.startsWith("/")) {
    line = line.slice(1).trimStart();
    if (!line) return { exit: false };
  }

  // `techlogia X` -> `X` (Muscle-Memory: User tippt manchmal das Prefix mit).
  if (line === "techlogia") {
    // bare "techlogia" → in der Shell sinnlos, ignorieren
    return { exit: false };
  }
  if (line.startsWith("techlogia ")) {
    line = line.slice("techlogia ".length).trimStart();
  }

  const firstWord = line.split(/\s+/)[0].toLowerCase();

  // Built-ins die Shell-State beeinflussen — diese MUESSEN hier laufen
  // statt via commander, weil commander den Shell-State nicht kennt.
  switch (firstWord) {
    case "exit":
    case "quit":
    case "q":
      return { exit: true };
    case "clear":
      console.clear();
      return { exit: false };
    case "help":
    case "?":
      console.log(renderHelpBox(ctx.state.persona));
      return { exit: false };
    case "login":
      await handleLogin(ctx);
      return { exit: false };
    case "logout":
      await handleLogout(ctx);
      return { exit: false };
    case "student": {
      // `student login` als Built-in — Schüler-Klassen-Code-Flow
      const rest = line.split(/\s+/).slice(1)[0]?.toLowerCase();
      if (rest === "login") {
        await handleStudentLogin(ctx);
        return { exit: false };
      }
      break;
    }
    case "whoami": {
      if (!ctx.state.me) {
        ui.warn("Nicht angemeldet.");
        console.log(ui.dim("  ") + ui.cyan("/login") + ui.dim(" — Email/Passwort"));
        console.log(ui.dim("  ") + ui.cyan("/student login") + ui.dim(" — Klassen-Code"));
      } else {
        console.log("");
        console.log(`  ${ui.bold(ctx.state.me.display_name || ctx.state.me.username || ctx.state.me.email)}`);
        console.log(`  Rolle: ${ui.cyan(ctx.state.persona.label)} (${ctx.state.me.role})`);
        if (ctx.state.me.xp_total != null) console.log(`  XP: ${ctx.state.me.xp_total}`);
        console.log("");
      }
      return { exit: false };
    }
  }

  // lab attach — spezielle Promise/State-Handhabung
  if (line === "lab attach" || line.startsWith("lab attach ")) {
    await ctx.attachCurrentSession();
    return { exit: false };
  }

  // Alles weitere via commander, mit shell-quote für korrekte Args.
  const tokens = shellParse(line).filter((t): t is string => typeof t === "string");
  if (tokens.length === 0) return { exit: false };

  // Wenn nicht eingeloggt + Befehl braucht Auth -> friendly hint statt 401
  if (!ctx.state.me && needsAuth(tokens[0])) {
    ui.warn(`"${tokens[0]}" braucht ein Login.`);
    console.log(ui.dim("  → ") + ui.cyan("/login") + ui.dim(" (Email/Passwort) oder ") + ui.cyan("/student login") + ui.dim(" (Klassen-Code)"));
    return { exit: false };
  }

  try {
    await ctx.program.parseAsync(["node", "techlogia", ...tokens]);
  } catch (err) {
    const e = err as { code?: string; exitCode?: number; message?: string };
    if (e?.code === "commander.help" || e?.code === "commander.version" || e?.exitCode === 0) {
      // ok — Hilfe wurde gerendert
    } else if (e?.code === "commander.unknownCommand") {
      ui.error(`Unbekannter Befehl: ${tokens[0]} — tipp ` + ui.cyan("/help") + ui.red(" für Liste."));
    } else if (e?.message) {
      ui.error(e.message);
    }
  }
  return { exit: false };
}

function needsAuth(cmd: string): boolean {
  // Welche Top-Level-Commands brauchen ein Login? (Frueher-Branch ohne 401-Roundtrip)
  return ["lab", "class", "school", "admin", "account"].includes(cmd);
}

// ─────────────────────────── Shell entry ───────────────────────────

export async function runShell(program: Command): Promise<void> {
  applyExitOverride(program);

  const me = await loadMe();
  const persona = getPersonaForUser(me);
  const activeSession = me && persona.allowedCommands.includes("lab") ? await loadActiveSession() : null;

  const state: ShellState = { me, persona, activeSession };

  // Welcome — egal ob eingeloggt oder nicht.
  if (state.me) {
    console.log(renderWelcome({ me: state.me, persona: state.persona, activeSession: state.activeSession, version: CLI_VERSION }));
  } else {
    renderGuestWelcome();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPromptFor(state),
    terminal: true,
    historySize: 200,
  });

  const refreshPrompt = (): void => {
    rl.setPrompt(buildPromptFor(state));
  };

  const refreshIdentity = async (): Promise<void> => {
    state.me = await loadMe();
    state.persona = getPersonaForUser(state.me);
  };

  const refreshActiveSession = async (): Promise<void> => {
    state.activeSession =
      state.me && state.persona.allowedCommands.includes("lab")
        ? await loadActiveSession()
        : null;
    refreshPrompt();
  };

  const attachCurrentSession = async (): Promise<void> => {
    if (!state.me) {
      ui.warn("Erst /login.");
      return;
    }
    if (!state.activeSession) await refreshActiveSession();
    if (!state.activeSession) {
      ui.error("Keine aktive Session.");
      console.log(ui.dim("  → ") + ui.cyan("lab start <modul>"));
      return;
    }
    const sid = sessionId(state.activeSession);
    if (!sid) {
      ui.error("Aktive Session ohne ID.");
      return;
    }
    const tok = await getAccessToken();
    if (!tok) {
      ui.error("Token verloren — bitte /login.");
      return;
    }
    ui.info(`Verbinde mit ${ui.cyan(sid)}...  ${ui.dim("(Strg+P Strg+Q = Detach)")}`);
    rl.pause();
    const result = await attachToSession(sid, tok);
    renderAttachResult(result);
    await refreshActiveSession();
    rl.resume();
    rl.prompt();
  };

  const ctx: ShellContext = {
    program,
    state,
    rl,
    attachCurrentSession,
    refreshActiveSession,
    refreshIdentity,
    refreshPrompt,
  };

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on("line", async (line) => {
      try {
        const { exit } = await runOnce(line, ctx);
        if (exit) {
          rl.close();
          return;
        }
        // Nur diese 3 Commands aendern den VM-Session-Zustand serverseitig
        // (start legt an, stop terminiert, status kann Reaper-Terminierung
        // sichtbar machen). Der Prompt zeigt die aktive Session an — ohne
        // Refresh wuerde er nach `lab stop` noch "VM laeuft" anzeigen.
        // Bewusst KEIN Refresh nach jedem Command: das waere 1 API-Call
        // pro Eingabe (Latenz im REPL + unnoetige Backend-Last).
        const trimmed = line.trim().replace(/^\//, "").trim();
        if (
          trimmed.startsWith("lab start") ||
          trimmed.startsWith("lab stop") ||
          trimmed.startsWith("lab status")
        ) {
          await refreshActiveSession();
        }
      } catch (err) {
        ui.error(String(err));
      }
      rl.prompt();
    });
    rl.on("close", () => {
      console.log("");
      console.log(ui.dim("  Bis bald."));
      console.log("");
      resolve();
    });
  });
}

function buildPromptFor(state: ShellState): string {
  if (state.me) {
    return buildModernPrompt({
      me: state.me,
      persona: state.persona,
      activeSession: state.activeSession,
    });
  }
  // Anonymer Prompt — minimal, blau ❯
  const top = ui.dim("╭─ ") + ui.cyan("guest");
  const bot = ui.dim("╰─") + ui.cyan("❯ ");
  return top + "\n" + bot;
}

function renderGuestWelcome(): void {
  console.log("");
  console.log("  " + ui.bold("Techlogia Shell") + ui.dim("  ·  ") + ui.dim(`v${CLI_VERSION}`));
  console.log("");
  console.log("  " + ui.yellow("Nicht eingeloggt.") + " Tipp:");
  console.log("    " + ui.cyan("/login") + ui.dim("           Email/Passwort"));
  console.log("    " + ui.cyan("/student login") + ui.dim("   Klassen-Code (Schüler)"));
  console.log("    " + ui.cyan("/help") + ui.dim("            sichtbare Befehle"));
  console.log("    " + ui.cyan("/exit") + ui.dim("            Shell verlassen"));
  console.log("");
}
