import readline from "node:readline";
import { Command } from "commander";
import { parse as shellParse } from "shell-quote";
import { api } from "./api/client";
import { getAccessToken } from "./api/storage";
import { AuthMeResponse } from "./api/types";
import { getPersonaForUser, Persona } from "./personas";
import { ui } from "./ui";
import { attachToSession, renderAttachResult } from "./commands/attach";
import { sessionId } from "./api/types";
import { LabSession } from "./api/types";

// `techlogia shell` — Interactive REPL. Spiegelt das Verhalten von
// mongosh / aws shell / gcloud interactive: User tippt `techlogia` einmal,
// landet in einem Prompt, gibt dort nur noch Sub-Commands ohne Prefix.
//
// Built-ins (in dieser Schicht, nicht via commander):
//   help / ?   — Persona-spezifische Befehls-Liste
//   exit/quit  — verlaesst die Shell
//   clear      — clearscreen
//   whoami     — Shortcut auf api/me-Roundtrip ohne commander-overhead
//
// Alles andere geht ueber den uebergebenen commander-Program. commander.parseAsync
// wuerde normal process.exit aufrufen bei Fehler / --help — wir setzen
// exitOverride() rekursiv damit beides ohne Crash zur Shell zurueckgibt.

interface ShellContext {
  program: Command;
  attachCurrentSession: () => Promise<void>;
}

function buildPrompt(persona: Persona, me: AuthMeResponse | null): string {
  const name = me?.display_name || me?.username || me?.email || "guest";
  return `${ui.bold("techlogia")} ${ui.dim("[")}${ui.cyan(persona.label)}${ui.dim(" · ")}${name}${ui.dim("]")} > `;
}

function applyExitOverride(cmd: Command): void {
  // Rekursiv exitOverride() setzen — sonst killt commander den Prozess bei
  // --help oder unknown options. Wir wollen stattdessen eine Exception
  // catchen und zur Shell zurueck.
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}

function printBuiltinHelp(persona: Persona): void {
  console.log("");
  console.log(ui.bold(`Verfuegbare Befehle — ${persona.label}`));
  console.log(ui.dim("─".repeat(60)));
  const groups: Array<[string, Array<[string, string]>]> = [
    ["Built-ins", [
      ["help / ?", "diese Liste"],
      ["whoami", "Wer bin ich + Persona"],
      ["clear", "Bildschirm leeren"],
      ["exit / quit", "Shell beenden"],
    ]],
    ["Anmeldung", [
      ["logout", "lokale Sitzung beenden"],
    ]],
    ["Allgemein", [
      ["health", "API-Erreichbarkeit pruefen"],
      ["blog list", "Blog-Beitraege"],
      ["legal show impressum", "Rechtstext"],
    ]],
  ];
  if (persona.allowedCommands.includes("lab")) {
    groups.push(["Lab", [
      ["lab modules", "Module browsen"],
      ["lab lessons", "Lektionen anzeigen"],
      ["lab read <slug>", "Lektion lesen"],
      ["lab start <modul>", "VM-Session starten"],
      ["lab status", "Aktive Session"],
      ["lab attach", "in die VM einloggen"],
      ["lab validate <task>", "Task pruefen"],
      ["lab stop --last", "Session beenden"],
      ["lab cost", "Kosten heute"],
    ]]);
  }
  if (persona.allowedCommands.includes("class")) {
    groups.push(["Klassen (Lehrer)", [
      ["class list", "eigene Klassen"],
      ["class create", "neue Klasse"],
      ["class students <id>", "Schueler-Liste"],
      ["class quota <id> --max <n>", "Tageslimit setzen"],
    ]]);
  }
  if (persona.allowedCommands.includes("school")) {
    groups.push(["Schule", [
      ["school teachers", "Lehrer der Schule"],
      ["school create-teacher", "neuen Lehrer anlegen"],
      ["school classes", "alle Klassen"],
    ]]);
  }
  if (persona.allowedCommands.includes("admin")) {
    groups.push(["Admin", [
      ["admin dashboard", "Dashboard"],
      ["admin users", "Nutzer"],
      ["admin lab-stats", "Lab-Statistiken"],
    ]]);
  }
  for (const [groupName, entries] of groups) {
    console.log("");
    console.log(ui.bold(groupName));
    for (const [cmd, desc] of entries) {
      console.log(`  ${ui.cyan(cmd.padEnd(30))} ${ui.dim(desc)}`);
    }
  }
  console.log("");
  console.log(ui.dim("Hilfe zu einem Befehl: ") + ui.cyan("<befehl> --help"));
  console.log(ui.dim("Tipp: ") + ui.cyan("Strg+D") + ui.dim(" zum Verlassen"));
  console.log("");
}

async function loadMe(): Promise<AuthMeResponse | null> {
  try {
    return (await api.get<AuthMeResponse>("/api/auth/me")).data;
  } catch {
    return null;
  }
}

async function runOnce(line: string, ctx: ShellContext, persona: Persona, me: AuthMeResponse | null): Promise<{ exit: boolean }> {
  const trimmed = line.trim();
  if (!trimmed) return { exit: false };

  // Built-ins direkt
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (firstWord === "exit" || firstWord === "quit") {
    return { exit: true };
  }
  if (firstWord === "clear") {
    console.clear();
    return { exit: false };
  }
  if (firstWord === "help" || firstWord === "?") {
    printBuiltinHelp(persona);
    return { exit: false };
  }
  if (firstWord === "whoami") {
    if (!me) {
      ui.error("Nicht angemeldet.");
    } else {
      console.log("");
      console.log(`  ${ui.bold(me.display_name || me.username || me.email)}`);
      console.log(`  Rolle: ${ui.cyan(persona.label)} (${me.role})`);
      if (me.xp_total != null) console.log(`  XP: ${me.xp_total}`);
      console.log("");
    }
    return { exit: false };
  }

  // lab attach speziell behandeln — die existing CLI-action ruft process.exit
  // im PromiseChain wenn die WS schliesst (was wir nicht wollen in der shell).
  // Stattdessen rufen wir attachToSession direkt + pause readline waehrend.
  if (trimmed === "lab attach" || trimmed.startsWith("lab attach ")) {
    await ctx.attachCurrentSession();
    return { exit: false };
  }

  // Restliche Commands ueber commander routen. shell-quote handhabt Quotes.
  const tokens = shellParse(trimmed).filter((t): t is string => typeof t === "string");
  if (tokens.length === 0) return { exit: false };

  try {
    // commander erwartet [node, script, ...args]. Wir mocken die ersten beiden.
    await ctx.program.parseAsync(["node", "techlogia", ...tokens]);
  } catch (err) {
    // exitOverride wirft eine CommanderError-Instanz statt process.exit.
    // exitCode 0 = --help/--version (kein Fehler, nur frueher exit).
    const e = err as { code?: string; exitCode?: number; message?: string };
    if (e?.code === "commander.help" || e?.code === "commander.version" || e?.exitCode === 0) {
      // ok — Hilfe wurde gerendert, einfach zurueck.
    } else if (e?.code === "commander.unknownCommand") {
      ui.error(`Unbekannter Befehl: ${tokens[0]} — tipp ` + ui.cyan("help") + ui.red(" fuer Liste."));
    } else if (e?.message) {
      ui.error(e.message);
    }
  }
  return { exit: false };
}

export async function runShell(program: Command): Promise<void> {
  applyExitOverride(program);

  const token = await getAccessToken();
  const me = token ? await loadMe() : null;
  const persona = getPersonaForUser(me);

  if (!me) {
    ui.warn("Nicht angemeldet — Shell-Mode braucht ein Login.");
    ui.info("Erst: " + ui.cyan("techlogia login") + ui.dim(" (oder ") + ui.cyan("techlogia student login") + ui.dim(")"));
    return;
  }

  console.log("");
  console.log(ui.bold("Techlogia Shell") + ui.dim(" — du bist drin."));
  console.log(`  Angemeldet als ${ui.cyan(me.email)} — Rolle ${ui.bold(persona.label)}`);
  console.log(ui.dim("  Tipp: ") + ui.cyan("help") + ui.dim(" zeigt deine Befehle · ") + ui.cyan("exit") + ui.dim(" verlaesst die Shell"));
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(persona, me),
    terminal: true,
    historySize: 100,
  });

  const attachCurrentSession = async (): Promise<void> => {
    const sessResp = await api
      .get<LabSession | null>("/api/lab/sessions/active")
      .catch(() => ({ data: null }));
    if (!sessResp.data) {
      ui.error("Keine aktive Session.");
      ui.info("Erst starten: " + ui.cyan("lab start <modul>"));
      return;
    }
    const sid = sessionId(sessResp.data);
    if (!sid) {
      ui.error("Aktive Session ohne ID.");
      return;
    }
    const tok = await getAccessToken();
    if (!tok) {
      ui.error("Nicht angemeldet.");
      return;
    }
    ui.info(`Verbinde mit ${ui.cyan(sid)}... (Strg+P Strg+Q zum Detach)`);
    // readline pausieren — sonst frisst es die stdin-Bytes die fuer das WS
    // gedacht sind. Nach Detach wieder aktivieren.
    rl.pause();
    const result = await attachToSession(sid, tok);
    renderAttachResult(result);
    rl.resume();
    rl.prompt();
  };

  const ctx: ShellContext = { program, attachCurrentSession };

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on("line", async (line) => {
      try {
        const { exit } = await runOnce(line, ctx, persona, me);
        if (exit) {
          rl.close();
          return;
        }
      } catch (err) {
        ui.error(String(err));
      }
      rl.prompt();
    });
    rl.on("close", () => {
      console.log("");
      ui.dim("Bis bald.");
      resolve();
    });
  });
}
