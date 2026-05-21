import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";
import { marked } from "marked";
// @ts-expect-error - marked-terminal hat keine eigenen TS-Types für v7
import { markedTerminal } from "marked-terminal";
import { api } from "../api/client";
import {
  CostEstimate,
  LabLessonDetail,
  LabLessonSummary,
  LabModule,
  LabSession,
  resolveI18n,
  sessionExpiry,
  sessionId,
  sessionIp,
} from "../api/types";
import { config } from "../config";
import { formatDate, formatDuration, printError, ui } from "../ui";
import { attachCommand } from "./attach";
import { validateCommand } from "./validate";

marked.use(markedTerminal() as never);

export const labCommand = new Command("lab").description("Lernlabor — Module, Lektionen und VM-Sessions");
labCommand.addCommand(attachCommand);
labCommand.addCommand(validateCommand);

function loc(): "de" | "en" {
  return config.get("locale");
}

labCommand
  .command("modules")
  .alias("list")
  .description("Verfügbare Lab-Module anzeigen")
  .action(async () => {
    const spinner = ora("Lade Module...").start();
    try {
      const resp = await api.get<{ modules?: LabModule[] } | LabModule[]>(
        "/api/lab/modules",
      );
      spinner.stop();
      const modules: LabModule[] = Array.isArray(resp.data)
        ? resp.data
        : resp.data.modules ?? [];

      if (modules.length === 0) {
        ui.info("Keine Module sichtbar.");
        ui.info(
          "Als Schüler musst du warten, bis dein Lehrer Module für deine Klasse freischaltet.",
        );
        return;
      }

      console.log("");
      console.log(ui.bold(`${modules.length} Module verfügbar`));
      console.log(ui.dim("─".repeat(60)));
      for (const m of modules) {
        const title = resolveI18n(m.title, loc());
        const description = resolveI18n(m.description, loc());
        const lock = m.is_locked ? ui.yellow(" [gesperrt]") : "";
        const duration = m.estimated_duration_minutes ?? m.duration_minutes;
        const progress = m.progress;
        const progressTag = progress?.total_tasks
          ? ui.dim(`· ${progress.passed ?? 0}/${progress.total_tasks} Tasks`)
          : "";

        console.log(`${ui.cyan("●")} ${ui.bold(title)}${lock}`);
        console.log(
          `  ${ui.dim(m.slug)} · ${ui.dim(m.difficulty ?? "?")} · ${formatDuration(duration)} ${progressTag}`,
        );
        if (description) {
          const shortened = description.length > 120 ? description.slice(0, 117) + "..." : description;
          console.log(`  ${ui.dim(shortened)}`);
        }
        if (progress?.first_lesson_slug) {
          console.log(`  ${ui.dim("Start: ")}${ui.cyan("techlogia lab read " + progress.first_lesson_slug)}`);
        }
        console.log("");
      }
      console.log(ui.dim("Lektionen: ") + ui.cyan("techlogia lab lessons --module <slug>"));
      console.log(ui.dim("Starten:   ") + ui.cyan("techlogia lab start <slug>"));
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

labCommand
  .command("lessons")
  .description("Lektionen anzeigen")
  .option("-m, --module <slug>", "Nur Lektionen eines Moduls")
  .action(async (opts: { module?: string }) => {
    const spinner = ora("Lade Lektionen...").start();
    try {
      const url = opts.module
        ? `/api/lab/lessons?module=${encodeURIComponent(opts.module)}`
        : "/api/lab/lessons";
      const resp = await api.get<LabLessonSummary[] | { lessons?: LabLessonSummary[] }>(url);
      spinner.stop();
      const lessons: LabLessonSummary[] = Array.isArray(resp.data)
        ? resp.data
        : resp.data.lessons ?? [];

      if (lessons.length === 0) {
        ui.info("Keine Lektionen gefunden.");
        return;
      }
      console.log("");
      console.log(ui.bold(`${lessons.length} Lektionen`));
      console.log(ui.dim("─".repeat(60)));
      for (const l of lessons) {
        const moduleTag = l.module_slug ? ui.dim(`[${l.module_slug}]`) + " " : "";
        const order =
          l.display_order != null
            ? ui.dim(`#${l.display_order} `)
            : l.order_index != null
              ? ui.dim(`#${l.order_index} `)
              : "";
        const time = l.estimated_minutes ? ui.dim(`· ${formatDuration(l.estimated_minutes)}`) : "";
        const tasks = l.task_count != null ? ui.dim(`· ${l.task_count} Tasks`) : "";
        console.log(`  ${order}${moduleTag}${ui.bold(resolveI18n(l.title, loc()))} ${time}${tasks}`);
        console.log(`  ${ui.dim(l.slug)}`);
        if (l.intro_preview) {
          const preview = resolveI18n(l.intro_preview, loc()).replace(/\n/g, " ");
          if (preview) console.log(`  ${ui.dim(preview.slice(0, 100))}`);
        }
      }
      console.log("");
      console.log(ui.dim("Lesen: ") + ui.cyan("techlogia lab read <slug>"));
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

labCommand
  .command("read <slug>")
  .description("Lektion lesen (Markdown-Render im Terminal)")
  .action(async (slug: string) => {
    const spinner = ora(`Lade Lektion ${slug}...`).start();
    try {
      const resp = await api.get<LabLessonDetail>(`/api/lab/lessons/${slug}`);
      spinner.stop();
      const lesson = resp.data;

      console.log("");
      console.log(ui.bold(resolveI18n(lesson.title, loc())));
      if (lesson.module_title) {
        console.log(ui.dim(`Modul: ${resolveI18n(lesson.module_title, loc())}`));
      } else if (lesson.module_slug) {
        console.log(ui.dim(`Modul: ${lesson.module_slug}`));
      }
      console.log(ui.dim("─".repeat(60)));
      console.log("");

      // Backend liefert den Lektions-Text als intro_md (i18n-Object).
      // content_markdown / content sind Fallbacks falls das Schema sich aendert.
      const md = resolveI18n(lesson.intro_md ?? lesson.content_markdown ?? lesson.content, loc());
      if (md) {
        console.log(await marked.parse(md));
      } else if (lesson.blocks && lesson.blocks.length > 0) {
        for (const block of lesson.blocks) {
          const content =
            typeof block.content === "string"
              ? block.content
              : resolveI18n(block.content, loc());
          if (block.type === "markdown" && content) {
            console.log(await marked.parse(content));
          } else if (block.type === "code" && content) {
            console.log(ui.dim("```"));
            console.log(ui.green(content));
            console.log(ui.dim("```"));
          } else if (content) {
            console.log(content);
          } else {
            console.log(ui.dim(`[Block: ${block.type}]`));
          }
        }
      } else if (lesson.intro_preview) {
        console.log(resolveI18n(lesson.intro_preview, loc()));
      } else {
        ui.info("Keine Inhalte vorhanden.");
      }

      // Aufgaben-Beschreibungen sind oft ausfuehrlich — wir zeigen hier nur
      // die Titel-Liste. Voller Task-Text via `lab validate <slug>` oder
      // im Browser-Player.

      if (lesson.tasks && lesson.tasks.length > 0) {
        console.log("");
        console.log(ui.bold(`Aufgaben (${lesson.tasks.length})`));
        console.log(ui.dim("─".repeat(60)));
        for (const t of lesson.tasks) {
          console.log(`  • ${ui.cyan(t.slug)} — ${resolveI18n(t.title, loc())}`);
        }
      }
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

labCommand
  .command("start <module_slug>")
  .description("Eine neue Lab-Session (VM) für ein Modul starten")
  .option("-y, --yes", "Cost-Banner überspringen", false)
  .action(async (moduleSlug: string, opts: { yes: boolean }) => {
    try {
      if (!opts.yes) {
        try {
          const cost = (await api.get<CostEstimate>("/api/lab/cost-estimate")).data;
          console.log("");
          console.log(ui.yellow("Kosten-Hinweis"));
          if (cost.today_eur != null) {
            console.log(`  Heute genutzt: ${cost.today_eur.toFixed(2)} ${cost.currency ?? "EUR"}`);
          }
          if (cost.threshold_eur != null) {
            console.log(`  Tageslimit   : ${cost.threshold_eur.toFixed(2)} ${cost.currency ?? "EUR"}`);
          }
          if (cost.active_sessions != null) {
            console.log(`  Aktive Sessions: ${cost.active_sessions}`);
          }
          console.log("");
        } catch {
          // Cost-Endpoint nicht-blockierend
        }
        const { ok } = await prompts({
          type: "confirm",
          name: "ok",
          message: `Modul "${moduleSlug}" starten? Es wird eine echte VM gespawnt.`,
          initial: true,
        });
        if (!ok) {
          ui.warn("Abgebrochen.");
          return;
        }
      }

      const spinner = ora(`Starte VM für ${moduleSlug}...`).start();
      const resp = await api.post<LabSession>("/api/lab/sessions", {
        module_slug: moduleSlug,
      });
      spinner.stop();

      const s = resp.data;
      const sid = sessionId(s) ?? "?";
      ui.success(`Session ${sid} gestartet (${s.status}).`);
      const lessonTitle = resolveI18n(s.lesson_title, loc());
      if (lessonTitle) console.log(`  Lektion   : ${lessonTitle}`);
      if (s.module_slug) console.log(`  Modul     : ${s.module_slug}`);
      else if (s.lesson_slug) console.log(`  Lektion-Slug: ${s.lesson_slug}`);
      const ip = sessionIp(s);
      if (ip) console.log(`  VM-IP     : ${ui.cyan(ip)}`);
      if (s.vm_user) console.log(`  SSH-User  : ${ui.cyan(s.vm_user)}`);
      if (s.cost_per_hour_eur != null) console.log(`  Kosten/h  : ${s.cost_per_hour_eur.toFixed(2)} EUR`);
      const exp = sessionExpiry(s);
      if (exp) console.log(`  Läuft ab : ${formatDate(exp)}`);
      if (s.terminal_url) {
        console.log("");
        console.log(`  Terminal im Browser: ${ui.cyan(s.terminal_url)}`);
      }
      console.log("");
      console.log(ui.dim("Status: ") + ui.cyan("techlogia lab status"));
      console.log(ui.dim("Beenden: ") + ui.cyan(`techlogia lab stop ${sid}`));
    } catch (err) {
      printError(err);
    }
  });

labCommand
  .command("status")
  .description("Aktive Lab-Sessions anzeigen")
  .action(async () => {
    try {
      const resp = await api.get<LabSession[] | { sessions?: LabSession[] } | null>(
        "/api/lab/sessions/active",
      );
      // Backend liefert NULL wenn keine Session aktiv (statt {sessions:[]}
      // oder []). Defensiv handhaben sonst crasht .sessions auf null.
      // Backend liefert ENTWEDER null (keine aktive Session) ODER ein
      // einzelnes Session-Object (nicht Array, da pro User nur eine Session
      // gleichzeitig aktiv sein kann). Sehr selten {sessions:[]}-Form.
      let sessions: LabSession[] = [];
      if (resp.data == null) {
        sessions = [];
      } else if (Array.isArray(resp.data)) {
        sessions = resp.data;
      } else if (typeof resp.data === "object" && "sessions" in resp.data) {
        sessions = (resp.data as { sessions?: LabSession[] }).sessions ?? [];
      } else if (
        typeof resp.data === "object" &&
        (("session_id" in resp.data) || ("id" in resp.data))
      ) {
        sessions = [resp.data as LabSession];
      }

      if (sessions.length === 0) {
        ui.info("Keine aktive Session.");
        console.log(ui.dim("  → Start mit ") + ui.cyan("techlogia lab start <modul>"));
        return;
      }

      console.log("");
      console.log(ui.bold(`${sessions.length} aktive Session(s)`));
      console.log(ui.dim("─".repeat(60)));
      for (const s of sessions) {
        const sid = sessionId(s) ?? "?";
        console.log(`${ui.cyan("●")} ${sid} (${ui.yellow(s.status)})`);
        const lessonTitle = resolveI18n(s.lesson_title, loc());
        if (lessonTitle) console.log(`  Lektion  : ${lessonTitle}`);
        if (s.lesson_slug) console.log(`  Slug     : ${s.lesson_slug}`);
        const ip = sessionIp(s);
        if (ip) console.log(`  VM-IP    : ${ui.cyan(ip)}`);
        if (s.cost_per_hour_eur != null)
          console.log(`  Kosten/h : ${s.cost_per_hour_eur.toFixed(2)} EUR`);
        if (s.started_at) console.log(`  Gestartet: ${formatDate(s.started_at)}`);
        const exp = sessionExpiry(s);
        if (exp) console.log(`  Bis      : ${formatDate(exp)}`);
        console.log("");
      }
    } catch (err) {
      printError(err);
    }
  });

labCommand
  .command("stop [session_id]")
  .description("Eine Lab-Session vorzeitig beenden (VM zerstoeren)")
  .option("-y, --yes", "Confirm-Prompt überspringen", false)
  .option("--last", "Aktuell aktive Session beenden (keine ID noetig)", false)
  .action(async (sessionIdArg: string | undefined, opts: { yes: boolean; last: boolean }) => {
    try {
      let targetId = sessionIdArg;

      if (opts.last || !targetId) {
        // Aktive Session über /active-Endpoint ermitteln — User muss
        // sich die UUID nicht aus der vorigen Ausgabe kopieren.
        const resp = await api.get<LabSession | null>("/api/lab/sessions/active");
        if (!resp.data) {
          ui.info("Keine aktive Session zum Beenden.");
          return;
        }
        targetId = sessionId(resp.data);
        if (!targetId) {
          ui.error("Aktive Session gefunden aber ohne ID — Backend-Response unerwartet.");
          return;
        }
      }

      if (!opts.yes) {
        const { ok } = await prompts({
          type: "confirm",
          name: "ok",
          message: `Session ${targetId} wirklich beenden? Die VM wird zerstoert.`,
          initial: false,
        });
        if (!ok) return;
      }

      const spinner = ora("Beende Session...").start();
      // Backend nutzt DELETE /api/lab/sessions/{id} für Terminate
      // (REST-konform), nicht POST + /terminate.
      await api.delete(`/api/lab/sessions/${targetId}`);
      spinner.stop();
      ui.success(`Session ${targetId} beendet.`);
    } catch (err) {
      printError(err);
    }
  });

labCommand
  .command("cost")
  .description("Lab-Kosten-Verbrauch anzeigen")
  .action(async () => {
    try {
      const cost = (await api.get<CostEstimate>("/api/lab/cost-estimate")).data;
      const currency = cost.currency ?? "EUR";
      console.log("");
      console.log(ui.bold("Lab-Kosten"));
      console.log(ui.dim("─".repeat(60)));
      if (cost.today_eur != null) {
        console.log(`  Heute genutzt  : ${ui.cyan(cost.today_eur.toFixed(2) + " " + currency)}`);
      }
      if (cost.threshold_eur != null) {
        const exceeded = cost.threshold_exceeded ? ui.red(" (UEBERSCHRITTEN)") : "";
        console.log(`  Tageslimit     : ${cost.threshold_eur.toFixed(2)} ${currency}${exceeded}`);
      }
      if (cost.active_sessions != null) {
        console.log(`  Aktive Sessions: ${cost.active_sessions}`);
      }
      if (cost.monthly_used_cents != null) {
        const eur = (cost.monthly_used_cents / 100).toFixed(2);
        console.log(`  Monat (legacy) : ${eur} ${currency}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
