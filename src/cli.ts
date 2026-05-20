import { Command } from "commander";
import updateNotifier from "update-notifier";
import { CLI_VERSION, api } from "./api/client";
import { getAccessToken } from "./api/storage";
import { AuthMeResponse } from "./api/types";
import { getAllPersonas, getPersonaForUser } from "./personas";
import { ui } from "./ui";
import { runShell } from "./shell";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth";
import { healthCommand, statusCommand } from "./commands/health";
import { blogCommand } from "./commands/blog";
import { legalCommand } from "./commands/legal";
import { labCommand } from "./commands/lab";
import { classCommand } from "./commands/teacher";
import { schoolCommand } from "./commands/school";
import { adminCommand } from "./commands/admin";
import { studentCommand } from "./commands/student";
import { accountCommand } from "./commands/account";

// update-notifier checkt async in einem Background-Prozess ob eine neuere
// npm-Version verfuegbar ist. Cache hat 1 Tag — kein Performance-Issue.
// Schmaler Lifetime-Patch: nicht in CI ausfuehren wo TTY fehlt, sonst
// schreibt notify() in stderr und verwirrt Pipes.
function maybeNotifyUpdate(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { name: string; version: string };
    const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
    if (process.stdout.isTTY) notifier.notify({ defer: false, isGlobal: true });
  } catch {
    // ignorieren — Updates checken ist nice-to-have, nicht critical
  }
}

async function loadCurrentUser(): Promise<AuthMeResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const resp = await api.get<AuthMeResponse>("/api/auth/me");
    return resp.data;
  } catch {
    return null;
  }
}

function printPersonaHelp(me: AuthMeResponse | null): void {
  const persona = getPersonaForUser(me);

  console.log("");
  console.log(ui.bold("Techlogia CLI ") + ui.dim(`v${CLI_VERSION}`));
  console.log("");

  if (me) {
    console.log(
      `Eingeloggt als ${ui.cyan(me.email)} — Rolle: ${ui.bold(persona.label)}`,
    );
    console.log(ui.dim(`  ${persona.description}`));
  } else {
    console.log(ui.yellow("Nicht angemeldet.") + " Login mit: " + ui.cyan("techlogia login"));
    console.log(ui.dim(`  Oeffentliche Befehle sind ohne Login verfuegbar.`));
  }

  console.log("");
  console.log(ui.bold("Verfuegbare Befehle"));
  console.log(ui.dim("─".repeat(60)));

  const commandsByGroup: Record<string, Array<[string, string]>> = {
    "Anmeldung": [
      ["login", "Bei Techlogia anmelden"],
      ["logout", "Lokale Sitzung beenden"],
      ["whoami", "Eingeloggte Identitaet zeigen"],
      ["student login", "Schueler-Login per Klassen-Code"],
    ],
    "Allgemein": [
      ["health", "API-Erreichbarkeit pruefen"],
      ["status", "Lokalen Status zeigen"],
      ["blog list/read", "Blog-Beitraege lesen"],
      ["legal show <slug>", "Impressum, Datenschutz, AGB"],
    ],
    "Lab (Lernplattform)": [
      ["lab modules", "Verfuegbare Module"],
      ["lab lessons", "Lektionen auflisten"],
      ["lab read <slug>", "Lektion im Terminal lesen"],
      ["lab start <modul>", "VM-Session starten"],
      ["lab status", "Aktive Sessions"],
      ["lab stop <id>", "Session beenden"],
      ["lab cost", "Kosten dieses Monats"],
    ],
    "Konto": [
      ["account profile", "Eigenes Profil"],
      ["account xp", "XP-Stand + Level"],
      ["account session-history", "Vergangene Sessions"],
    ],
    "Klassen (Lehrer)": [
      ["class list", "Eigene Klassen"],
      ["class create", "Neue Klasse anlegen"],
      ["class students <id>", "Schueler auflisten"],
      ["class delete <id>", "Klasse loeschen"],
    ],
    "Schule (Schul-Admin)": [
      ["school teachers", "Lehrer der Schule"],
      ["school create-teacher", "Neuen Lehrer anlegen"],
      ["school classes", "Alle Klassen der Schule"],
    ],
    "Plattform-Admin": [
      ["admin dashboard", "Admin-Dashboard"],
      ["admin users", "Nutzer auflisten"],
      ["admin lab-stats", "Lab-Statistiken"],
    ],
  };

  // Mappt Gruppen-Namen auf Command-Namespaces fuer den Persona-Filter
  const namespaceForGroup: Record<string, string> = {
    "Anmeldung": "login",
    "Allgemein": "health",
    "Lab (Lernplattform)": "lab",
    "Konto": "account",
    "Klassen (Lehrer)": "class",
    "Schule (Schul-Admin)": "school",
    "Plattform-Admin": "admin",
  };

  for (const [group, entries] of Object.entries(commandsByGroup)) {
    const ns = namespaceForGroup[group];
    // "Anmeldung" und "Allgemein" sind immer sichtbar.
    if (ns && ns !== "login" && ns !== "health" && !persona.allowedCommands.includes(ns)) {
      continue;
    }
    console.log("");
    console.log(ui.bold(group));
    for (const [cmd, desc] of entries) {
      console.log(`  ${ui.cyan(("techlogia " + cmd).padEnd(34))} ${ui.dim(desc)}`);
    }
  }

  console.log("");
  console.log(ui.dim("Hilfe zu einem Befehl: ") + ui.cyan("techlogia <befehl> --help"));
  console.log("");
}

export async function runCli(): Promise<void> {
  maybeNotifyUpdate();

  const program = new Command();
  program
    .name("techlogia")
    .description("Techlogia — Lernplattform als CLI (Lab + Konto + Schul-Verwaltung)")
    .version(CLI_VERSION, "-v, --version", "CLI-Version anzeigen")
    // Eigene Help-Routine die persona-spezifisch rendert.
    .helpOption("-h, --help", "Hilfe anzeigen");

  // Nach erfolgreichem Login direkt in den Shell-Mode springen — User sieht
  // alles in einem Terminal-Flow ohne zweiten Aufruf. Wir nutzen commander's
  // postAction-Hook, der nach action() laeuft. Inner-Check: nur wenn ein
  // Token tatsaechlich gespeichert wurde (sonst war Login fehlgeschlagen)
  // und wir in einer interaktiven TTY-Session sind.
  const launchShellIfLoggedIn = async (): Promise<void> => {
    if (!process.stdin.isTTY) return;
    const token = await getAccessToken();
    if (!token) return;
    await runShell(program);
  };
  loginCommand.hook("postAction", launchShellIfLoggedIn);
  studentCommand.hook("postAction", launchShellIfLoggedIn);

  // Subcommands registrieren
  program.addCommand(loginCommand);
  program.addCommand(logoutCommand);
  program.addCommand(whoamiCommand);
  program.addCommand(healthCommand);
  program.addCommand(statusCommand);
  program.addCommand(blogCommand);
  program.addCommand(legalCommand);
  program.addCommand(labCommand);
  program.addCommand(accountCommand);
  program.addCommand(classCommand);
  program.addCommand(schoolCommand);
  program.addCommand(adminCommand);
  program.addCommand(studentCommand);

  program
    .command("shell")
    .description("Interaktive Shell starten — alle Befehle ohne `techlogia`-Prefix")
    .action(async () => {
      await runShell(program);
    });

  program
    .command("personas")
    .description("Alle Persona-Varianten zeigen (Lerner, Lehrer, Admin, ...)")
    .action(() => {
      console.log("");
      console.log(ui.bold("Persona-Varianten"));
      console.log(ui.dim("─".repeat(60)));
      for (const p of getAllPersonas()) {
        console.log(`${ui.cyan("●")} ${ui.bold(p.label)} ${ui.dim(`(${p.kind})`)}`);
        console.log(`  ${ui.dim(p.description)}`);
        console.log(`  Befehle: ${p.allowedCommands.join(", ")}`);
        console.log("");
      }
    });

  // Ohne Argumente:
  //   - eingeloggt → Shell-Mode (interactive REPL)
  //   - nicht angemeldet → klassisches Help-Menu (zeigt login/health/blog)
  // Wer Help statt Shell will, kann `techlogia --help` oder
  // `techlogia personas` nutzen.
  if (process.argv.length <= 2) {
    const me = await loadCurrentUser();
    if (me && process.stdin.isTTY) {
      await runShell(program);
      return;
    }
    printPersonaHelp(me);
    return;
  }

  await program.parseAsync(process.argv);
}
