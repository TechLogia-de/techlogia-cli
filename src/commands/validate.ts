import { Command } from "commander";
import ora from "ora";
import { api } from "../api/client";
import {
  LabLessonDetail,
  LabSession,
  resolveI18n,
  sessionId,
} from "../api/types";
import { config } from "../config";
import { printError, ui } from "../ui";

// `lab validate` — Task-Validation aus der CLI. Workflow:
//   1. Aktive Session via /active → session_id + lesson_slug
//   2. GET /api/lab/lessons/{lesson_slug} → tasks[] mit slug → id
//   3. POST /api/lab/sessions/{sid}/validate {task_id}
//   4. Render passed/failed/hints

interface ValidateResponse {
  passed: boolean;
  message?: string;
  details?: Array<{ check?: string; passed?: boolean; hint?: string; output?: string }>;
  lynis_diff?: { before?: number; after?: number; delta?: number };
  xp_awarded?: number;
}

function loc(): "de" | "en" {
  return config.get("locale");
}

export const validateCommand = new Command("validate")
  .description("Eine Lab-Task validieren — Backend prueft, ob der Aufgaben-Check passt")
  .argument("<task_slug>", "Task-Slug aus der Lesson (z.B. disable-permitrootlogin)")
  .action(async (taskSlug: string) => {
    const spinner = ora("Validiere...").start();
    try {
      // 1) Aktive Session
      const sessResp = await api.get<LabSession | null>("/api/lab/sessions/active");
      const session = sessResp.data;
      if (!session) {
        spinner.stop();
        ui.error("Keine aktive Session.");
        ui.info("Erst starten: " + ui.cyan("techlogia lab start <modul>"));
        return;
      }
      const sid = sessionId(session);
      const lessonSlug = session.lesson_slug;
      if (!sid || !lessonSlug) {
        spinner.stop();
        ui.error("Session ohne Lesson-Slug — kann Task nicht aufloesen.");
        return;
      }

      // 2) Lesson holen → task_slug -> task_id
      const lessonResp = await api.get<LabLessonDetail>(`/api/lab/lessons/${lessonSlug}`);
      const tasks = lessonResp.data.tasks ?? [];
      const task = tasks.find((t) => t.slug === taskSlug);
      if (!task) {
        spinner.stop();
        ui.error(`Task "${taskSlug}" nicht in Lesson "${lessonSlug}" gefunden.`);
        ui.info(`Verfügbare Tasks: ${tasks.map((t) => t.slug).join(", ") || "—"}`);
        return;
      }

      // 3) Validieren
      const valResp = await api.post<ValidateResponse>(
        `/api/lab/sessions/${sid}/validate`,
        { task_id: task.id },
      );
      spinner.stop();

      const r = valResp.data;
      console.log("");
      if (r.passed) {
        ui.success(`Task "${resolveI18n(task.title, loc())}" bestanden!`);
      } else {
        ui.error(`Task "${resolveI18n(task.title, loc())}" nicht bestanden.`);
      }
      if (r.message) console.log(`  ${r.message}`);
      if (r.xp_awarded) console.log(`  ${ui.cyan(`+${r.xp_awarded} XP`)}`);
      if (r.lynis_diff && r.lynis_diff.delta != null) {
        const sign = r.lynis_diff.delta >= 0 ? "+" : "";
        console.log(
          `  Lynis-Score: ${r.lynis_diff.before ?? "?"} → ${r.lynis_diff.after ?? "?"} (${sign}${r.lynis_diff.delta})`,
        );
      }
      if (r.details && r.details.length > 0) {
        console.log("");
        console.log(ui.bold("Checks"));
        for (const d of r.details) {
          const mark = d.passed ? ui.green("✓") : ui.red("✗");
          console.log(`  ${mark} ${d.check ?? ""}`);
          if (d.hint) console.log(`    ${ui.dim("Hint: " + d.hint)}`);
          if (d.output && !d.passed) {
            const trimmed = d.output.length > 200 ? d.output.slice(0, 200) + "…" : d.output;
            console.log(`    ${ui.dim(trimmed)}`);
          }
        }
      }
      console.log("");
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });
