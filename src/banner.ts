import chalk from "chalk";
import { AuthMeResponse, LabSession, resolveI18n, sessionId, sessionIp } from "./api/types";
import { config } from "./config";
import { Persona } from "./personas";

// Banner + Welcome-Screen + Two-line-Prompt — modernes CLI-Idiom (vgl. bun,
// lazygit, gh). Helper-Funktionen leben hier zentral; shell.ts ruft sie nur.
//
// Farben (Techlogia-Brand):
//   Primary:  #2563EB (Blau)
//   Accent:   #58e1c4 (Cyan/Mint)
//   Success:  #10B981 (Emerald)
//   Warning:  #F59E0B (Amber)
//   Error:    #F43F5E (Rose)
//   Muted:    #6B7280 (Gray-500)

const COL = {
  primary: "#2563EB",
  accent: "#58e1c4",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#F43F5E",
  muted: "#9CA3AF",
  text: "#F2F2EF",
};

/** Linearer Hex-zu-Hex-Gradient ueber `text` (1 Zeile). */
function gradientText(text: string, fromHex: string, toHex: string): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const chars = [...text];
  return chars
    .map((ch, i) => {
      if (ch === " " || ch === "\n") return ch;
      const t = chars.length === 1 ? 0 : i / (chars.length - 1);
      const r = Math.round(from.r + (to.r - from.r) * t);
      const g = Math.round(from.g + (to.g - from.g) * t);
      const b = Math.round(from.b + (to.b - from.b) * t);
      return chalk.rgb(r, g, b)(ch);
    })
    .join("");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

/** ASCII-Logo. Sechs-zeiliges "tech"-Block + tagline. */
const LOGO_LINES = [
  "████████╗███████╗ ██████╗██╗  ██╗",
  "╚══██╔══╝██╔════╝██╔════╝██║  ██║",
  "   ██║   █████╗  ██║     ███████║",
  "   ██║   ██╔══╝  ██║     ██╔══██║",
  "   ██║   ███████╗╚██████╗██║  ██║",
  "   ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝",
];

export function renderLogo(version: string): string {
  const gradientLogo = LOGO_LINES.map((line) =>
    gradientText(line, COL.primary, COL.accent),
  ).join("\n");
  const tagline =
    chalk.hex(COL.text).bold("  logia") +
    chalk.hex(COL.muted)(" · ") +
    chalk.hex(COL.accent)("lab") +
    chalk.hex(COL.muted)(" · ") +
    chalk.hex(COL.text)("cli") +
    "  ".repeat(8) +
    chalk.hex(COL.muted)(`v${version}`);
  return gradientLogo + "\n" + tagline;
}

interface WelcomeContext {
  me: AuthMeResponse;
  persona: Persona;
  activeSession: LabSession | null;
  version: string;
}

export function renderWelcome(ctx: WelcomeContext): string {
  const { me, persona, activeSession, version } = ctx;
  const lines: string[] = [];

  lines.push("");
  lines.push(renderLogo(version));
  lines.push("");

  // Name + Persona-Block
  const name = me.display_name || me.username || me.email;
  lines.push(
    chalk.hex(COL.text).bold("  Hallo ") +
      gradientText(name, COL.accent, COL.primary) +
      chalk.hex(COL.muted)("  —  Du bist drin."),
  );
  lines.push("");

  // Divider
  lines.push(chalk.hex(COL.muted)("  ╭─" + "─".repeat(60)));

  // Persona-Zeile
  lines.push(
    chalk.hex(COL.muted)("  │ ") +
      chalk.hex(COL.primary)("●") +
      chalk.hex(COL.text).bold(`  ${persona.label}`) +
      chalk.hex(COL.muted)("  ·  ") +
      chalk.hex(COL.muted)(persona.description),
  );

  // XP + Level wenn vorhanden
  if (me.xp_total != null && me.xp_total > 0) {
    const level = Math.floor(Math.sqrt(me.xp_total / 100));
    lines.push(
      chalk.hex(COL.muted)("  │ ") +
        chalk.hex(COL.warning)("◆") +
        chalk.hex(COL.text)(`  ${me.xp_total} XP`) +
        chalk.hex(COL.muted)(`  ·  Level ${level}`),
    );
  }

  // Klassen-Info (Schueler)
  if (me.student_class_id) {
    lines.push(
      chalk.hex(COL.muted)("  │ ") +
        chalk.hex(COL.accent)("◉") +
        chalk.hex(COL.text)(`  Klasse #${me.student_class_id}`),
    );
  }

  // Aktive Session
  if (activeSession) {
    const sid = sessionId(activeSession) ?? "?";
    const ip = sessionIp(activeSession);
    const lessonTitle = resolveI18n(activeSession.lesson_title, config.get("locale"));
    const statusColor =
      activeSession.status === "READY"
        ? COL.success
        : activeSession.status === "PROVISIONING"
          ? COL.warning
          : COL.muted;
    lines.push(
      chalk.hex(COL.muted)("  │ ") +
        chalk.hex(statusColor)("⚡") +
        chalk.hex(COL.text)("  VM ") +
        chalk.hex(COL.accent)(sid.slice(0, 8)) +
        chalk.hex(COL.muted)("…") +
        (ip ? chalk.hex(COL.muted)("  ·  ") + chalk.hex(COL.text)(ip) : "") +
        (lessonTitle
          ? chalk.hex(COL.muted)("  ·  ") + chalk.hex(COL.muted)(lessonTitle)
          : "") +
        chalk.hex(COL.muted)("  (") +
        chalk.hex(statusColor)(activeSession.status) +
        chalk.hex(COL.muted)(")"),
    );
  }

  lines.push(chalk.hex(COL.muted)("  ╰─" + "─".repeat(60)));
  lines.push("");

  // Bottom-Tipps
  lines.push(
    chalk.hex(COL.muted)("  ⌘  ") +
      chalk.hex(COL.text)("help") +
      chalk.hex(COL.muted)(" zeigt deine Befehle  ·  ") +
      chalk.hex(COL.text)("exit") +
      chalk.hex(COL.muted)(" beendet die Shell  ·  ") +
      chalk.hex(COL.text)("↑/↓") +
      chalk.hex(COL.muted)(" History"),
  );
  lines.push("");

  return lines.join("\n");
}

interface PromptContext {
  me: AuthMeResponse;
  persona: Persona;
  activeSession: LabSession | null;
}

/**
 * Two-line-Prompt. Oben: context (user, role, vm-dot). Unten: `❯` Input.
 *
 * Wir bauen ZWEI Zeilen — readline rendert die UNTERE als prompt + cursor.
 * Die obere drucken wir VOR dem Prompt-Render. Achtung: jeder Re-Render
 * der oberen Zeile braucht ein readline.prompt(true)-Cycle.
 */
export function buildPrompt(ctx: PromptContext): string {
  const { me, persona, activeSession } = ctx;
  const name = (me.display_name || me.username || me.email).split("@")[0];

  const segments: string[] = [];
  // Segment 1: persona
  segments.push(chalk.hex(COL.primary)(persona.label.toLowerCase()));
  // Segment 2: user
  segments.push(chalk.hex(COL.accent)(name));
  // Segment 3: VM-Status wenn aktiv
  if (activeSession) {
    const dot =
      activeSession.status === "READY"
        ? chalk.hex(COL.success)("⚡")
        : activeSession.status === "PROVISIONING"
          ? chalk.hex(COL.warning)("⚡")
          : chalk.hex(COL.muted)("⚡");
    const sid = sessionId(activeSession) ?? "?";
    segments.push(dot + chalk.hex(COL.muted)(" " + sid.slice(0, 8)));
  }

  const contextLine =
    chalk.hex(COL.muted)("╭─ ") + segments.join(chalk.hex(COL.muted)(" · "));
  const inputLine = chalk.hex(COL.muted)("╰─") + chalk.hex(COL.primary).bold("❯ ");

  // \n ist Teil der prompt-string — readline rendert das aber als "Prompt
  // ueber mehrere Zeilen" und der Cursor landet trotzdem richtig hinter
  // dem ❯. Funktioniert in modernen Terminals (iTerm2, kitty, Apple
  // Terminal).
  return contextLine + "\n" + inputLine;
}

export function renderHelpBox(persona: Persona): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.hex(COL.muted)("╭─ ") + chalk.bold.hex(COL.text)(`Befehle — ${persona.label}`));
  lines.push(chalk.hex(COL.muted)("│"));

  const sections: Array<[string, Array<[string, string]>]> = [
    ["Built-ins", [
      ["help / ?", "diese Liste"],
      ["whoami", "wer bin ich"],
      ["clear", "Bildschirm leeren"],
      ["exit / quit", "Shell beenden"],
    ]],
    ["Konto", [
      ["logout", "abmelden"],
    ]],
    ["Allgemein", [
      ["health", "API-Erreichbarkeit"],
      ["blog list", "Blog-Beitraege"],
      ["legal show impressum", "Rechtstexte"],
    ]],
  ];

  if (persona.allowedCommands.includes("lab")) {
    sections.push(["Lab", [
      ["lab modules", "Module browsen"],
      ["lab lessons", "Lektionen anzeigen"],
      ["lab read <slug>", "Lektion lesen"],
      ["lab start <modul>", "VM-Session starten"],
      ["lab status", "aktive Session"],
      ["lab attach", "in die VM einloggen"],
      ["lab validate <task>", "Task pruefen"],
      ["lab stop --last", "Session beenden"],
      ["lab cost", "Kosten heute"],
    ]]);
  }
  if (persona.allowedCommands.includes("class")) {
    sections.push(["Klassen (Lehrer)", [
      ["class list", "eigene Klassen"],
      ["class create", "neue Klasse"],
      ["class students <id>", "Schueler-Liste"],
      ["class quota <id> --max <n>", "Tageslimit"],
    ]]);
  }
  if (persona.allowedCommands.includes("school")) {
    sections.push(["Schule", [
      ["school teachers", "Lehrer der Schule"],
      ["school create-teacher", "Lehrer anlegen"],
      ["school classes", "alle Klassen"],
    ]]);
  }
  if (persona.allowedCommands.includes("admin")) {
    sections.push(["Admin", [
      ["admin dashboard", "Dashboard"],
      ["admin users", "Nutzer"],
      ["admin lab-stats", "Lab-Statistiken"],
    ]]);
  }

  for (const [name, entries] of sections) {
    lines.push(chalk.hex(COL.muted)("│  ") + chalk.bold.hex(COL.primary)(name));
    for (const [cmd, desc] of entries) {
      lines.push(
        chalk.hex(COL.muted)("│    ") +
          chalk.hex(COL.accent)(cmd.padEnd(30)) +
          chalk.hex(COL.muted)(desc),
      );
    }
    lines.push(chalk.hex(COL.muted)("│"));
  }
  lines.push(chalk.hex(COL.muted)("╰─ ") + chalk.hex(COL.muted)("Hilfe pro Befehl: ") + chalk.hex(COL.accent)("<befehl> --help"));
  lines.push("");

  return lines.join("\n");
}

export const colors = COL;
