import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";
import { api } from "../api/client";
import { SchoolClass, TeacherOut } from "../api/types";
import { formatDate, printError, ui } from "../ui";

export const schoolCommand = new Command("school").description(
  "Schul-Admin: Lehrer und Klassen verwalten",
);

schoolCommand
  .command("teachers")
  .description("Alle Lehrer der Schule anzeigen")
  .action(async () => {
    const spinner = ora("Lade Lehrer...").start();
    try {
      const resp = await api.get<TeacherOut[]>("/api/school/teachers");
      spinner.stop();
      const teachers = resp.data ?? [];
      if (teachers.length === 0) {
        ui.info("Keine Lehrer angelegt.");
        ui.info("Anlegen: " + ui.cyan("techlogia school create-teacher"));
        return;
      }
      console.log("");
      console.log(ui.bold(`${teachers.length} Lehrer`));
      console.log(ui.dim("─".repeat(60)));
      for (const t of teachers) {
        const active = t.is_active ? ui.green("aktiv") : ui.red("inaktiv");
        console.log(`  #${t.id.toString().padEnd(5)} ${ui.bold(t.email)} (${active})`);
        if (t.display_name) console.log(`         ${ui.dim(t.display_name)}`);
        if (t.created_at) console.log(`         ${ui.dim(formatDate(t.created_at))}`);
      }
      console.log("");
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

schoolCommand
  .command("create-teacher")
  .description("Neuen Lehrer für die Schule anlegen")
  .action(async () => {
    try {
      const responses = await prompts([
        {
          type: "text",
          name: "email",
          message: "Lehrer-Email",
          validate: (v: string) => (v.includes("@") ? true : "Bitte gültige Email"),
        },
        {
          type: "text",
          name: "display_name",
          message: "Anzeigename",
          validate: (v: string) => (v.length >= 2 ? true : "Mindestens 2 Zeichen"),
        },
      ]);
      if (!responses.email || !responses.display_name) return;

      const spinner = ora("Erstelle Lehrer...").start();
      const resp = await api.post<TeacherOut>("/api/school/teachers", responses);
      spinner.stop();
      ui.success(`Lehrer ${resp.data.email} erstellt (#${resp.data.id}).`);
      ui.info("Der Lehrer bekommt eine Einladungsmail mit Passwort-Setzen-Link.");
    } catch (err) {
      printError(err);
    }
  });

schoolCommand
  .command("delete-teacher <teacher_id>")
  .description("Lehrer aus der Schule entfernen")
  .action(async (teacherId: string) => {
    try {
      const { ok } = await prompts({
        type: "confirm",
        name: "ok",
        message: `Lehrer #${teacherId} wirklich entfernen?`,
        initial: false,
      });
      if (!ok) return;
      await api.delete(`/api/school/teachers/${teacherId}`);
      ui.success(`Lehrer #${teacherId} entfernt.`);
    } catch (err) {
      printError(err);
    }
  });

schoolCommand
  .command("classes")
  .description("Alle Klassen der Schule (auch von anderen Lehrern)")
  .action(async () => {
    try {
      const resp = await api.get<SchoolClass[]>("/api/school/classes");
      const classes = resp.data ?? [];
      if (classes.length === 0) {
        ui.info("Keine Klassen.");
        return;
      }
      console.log("");
      console.log(ui.bold(`${classes.length} Klasse(n) in der Schule`));
      console.log(ui.dim("─".repeat(60)));
      for (const c of classes) {
        console.log(`  #${c.id.toString().padEnd(5)} ${ui.bold(c.name)} — ${ui.yellow(c.class_code ?? "—")}`);
        if (c.student_count != null) console.log(`         ${ui.dim(`${c.student_count} Schüler`)}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
