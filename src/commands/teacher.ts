import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";
import { api } from "../api/client";
import { SchoolClass } from "../api/types";
import { formatDate, printError, ui } from "../ui";

export const classCommand = new Command("class").description(
  "Klassen verwalten (Lehrer & Schul-Admin)",
);

classCommand
  .command("list")
  .description("Eigene Klassen anzeigen")
  .action(async () => {
    const spinner = ora("Lade Klassen...").start();
    try {
      const resp = await api.get<SchoolClass[]>("/api/teacher/classes");
      spinner.stop();
      const classes = resp.data ?? [];
      if (classes.length === 0) {
        ui.info("Keine Klassen vorhanden.");
        ui.info("Erstellen mit: " + ui.cyan("techlogia class create"));
        return;
      }
      console.log("");
      console.log(ui.bold(`${classes.length} Klasse(n)`));
      console.log(ui.dim("─".repeat(60)));
      for (const c of classes) {
        console.log(`${ui.cyan("●")} #${c.id} — ${ui.bold(c.name)}`);
        if (c.class_code) console.log(`  Code       : ${ui.yellow(c.class_code)}`);
        if (c.student_count != null) console.log(`  Schüler   : ${c.student_count}`);
        if (c.created_at) console.log(`  Erstellt am: ${formatDate(c.created_at)}`);
        console.log("");
      }
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

classCommand
  .command("create")
  .description("Neue Klasse anlegen")
  .option("-n, --name <name>", "Klassenname")
  .action(async (opts: { name?: string }) => {
    try {
      const responses = await prompts([
        {
          type: opts.name ? null : "text",
          name: "name",
          message: "Klassenname",
          validate: (v: string) => (v.length >= 2 ? true : "Mindestens 2 Zeichen"),
        },
      ]);
      const name = opts.name ?? responses.name;
      if (!name) return;

      const spinner = ora("Erstelle Klasse...").start();
      const resp = await api.post<SchoolClass>("/api/teacher/classes", { name });
      spinner.stop();
      ui.success(`Klasse "${resp.data.name}" erstellt (#${resp.data.id}).`);
      if (resp.data.class_code) {
        console.log(`  Code für Schüler-Login: ${ui.bold.call(ui, resp.data.class_code)}`);
      }
    } catch (err) {
      printError(err);
    }
  });

classCommand
  .command("students <class_id>")
  .description("Schüler einer Klasse auflisten")
  .action(async (classId: string) => {
    try {
      const resp = await api.get<Array<{ id: number; student_login_name?: string; display_name?: string }>>(
        `/api/teacher/classes/${classId}/students`,
      );
      const students = resp.data ?? [];
      if (students.length === 0) {
        ui.info("Keine Schüler in dieser Klasse.");
        return;
      }
      console.log("");
      console.log(ui.bold(`${students.length} Schüler in Klasse #${classId}`));
      console.log(ui.dim("─".repeat(60)));
      for (const s of students) {
        console.log(
          `  #${s.id.toString().padEnd(5)} ${ui.cyan(s.student_login_name ?? "—")} ${ui.dim(s.display_name ?? "")}`,
        );
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });

classCommand
  .command("quota <class_id>")
  .description("Tageslimit für Sessions einer Klasse setzen (1-10)")
  .requiredOption("--max <n>", "Sessions pro Tag (1-10)")
  .action(async (classId: string, opts: { max: string }) => {
    try {
      const max = parseInt(opts.max, 10);
      if (!Number.isFinite(max) || max < 1 || max > 10) {
        ui.error("--max muss zwischen 1 und 10 liegen.");
        return;
      }
      const resp = await api.put<{ class_id: number; max_sessions_per_day: number; updated_at: string }>(
        `/api/teacher/classes/${classId}/quota`,
        { max_sessions_per_day: max },
      );
      ui.success(
        `Quota für Klasse #${resp.data.class_id} gesetzt: ${resp.data.max_sessions_per_day} Sessions/Tag.`,
      );
    } catch (err) {
      printError(err);
    }
  });

classCommand
  .command("delete <class_id>")
  .description("Klasse löschen")
  .action(async (classId: string) => {
    try {
      const { ok } = await prompts({
        type: "confirm",
        name: "ok",
        message: `Klasse #${classId} wirklich löschen? Alle Schüler-Konten gehen verloren.`,
        initial: false,
      });
      if (!ok) return;

      await api.delete(`/api/teacher/classes/${classId}`);
      ui.success(`Klasse #${classId} gelöscht.`);
    } catch (err) {
      printError(err);
    }
  });
