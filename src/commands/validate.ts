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
import { printError, safe, ui } from "../ui";

// `lab validate` — Task-Validation aus der CLI.
//
// Zwei Modi:
//   - Ohne Argument: zeigt die Tasks der aktuellen Lesson mit Progress
//     (welche schon bestanden, welche noch nicht). Hilft beim Überblick
//     nach Detach aus der VM.
//   - Mit Argument <task_slug>: triggert die Backend-Validierung der
//     spezifischen Aufgabe.
//
// Backend-Flow:
//   1. Aktive Session via /api/lab/sessions/active → session_id + lesson_slug
//   2. GET /api/lab/lessons/{lesson_slug} → tasks[]
//   3. (validate-mode) POST /api/lab/sessions/{sid}/validate {task_id}

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

async function loadActiveLesson(): Promise<{
  sid: string;
  lessonSlug: string;
  detail: LabLessonDetail;
} | null> {
  const sessResp = await api.get<LabSession | null>("/api/lab/sessions/active");
  const session = sessResp.data;
  if (!session) {
    ui.error("Keine aktive Session.");
    ui.info("Erst starten: " + ui.cyan("techlogia lab start <modul>"));
    return null;
  }
  const sid = sessionId(session);
  const lessonSlug = session.lesson_slug;
  if (!sid || !lessonSlug) {
    ui.error("Session ohne Lesson-Slug — kann Tasks nicht aufloesen.");
    return null;
  }
  const lessonResp = await api.get<LabLessonDetail>(`/api/lab/lessons/${lessonSlug}`);
  return { sid, lessonSlug, detail: lessonResp.data };
}

function renderTaskList(detail: LabLessonDetail): void {
  const tasks = detail.tasks ?? [];
  if (tasks.length === 0) {
    ui.warn("Diese Lesson hat (noch) keine Tasks.");
    return;
  }
  const title = typeof detail.title === "string" ? detail.title : resolveI18n(detail.title, loc());
  console.log("");
  console.log(ui.bold(title));
  console.log(ui.dim(`${tasks.length} Aufgabe${tasks.length === 1 ? "" : "n"}`));
  console.log("");

  // Per-User-Progress holt das Backend hier (noch) nicht — wir zeigen die
  // Task-Liste ohne Bestanden-Marker, damit der User weiss welche Slugs
  // er an `lab validate <slug>` geben kann.
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const num = `${i + 1}`.padStart(2, " ");
    const taskTitle = typeof t.title === "string" ? t.title : resolveI18n(t.title, loc());
    console.log(`  ${ui.dim("·")} ${num}. ${ui.bold(taskTitle)}`);
    console.log(`        ${ui.dim("slug:")} ${ui.cyan(t.slug)}`);
    if (t.description) {
      const desc = typeof t.description === "string" ? t.description : resolveI18n(t.description, loc());
      if (desc) {
        const trimmed = desc.length > 110 ? desc.slice(0, 107) + "…" : desc;
        console.log(`        ${ui.dim(trimmed)}`);
      }
    }
  }

  console.log("");
  console.log(
    ui.dim("Validieren: ") + ui.cyan("techlogia lab validate <slug>"),
  );
}

export const validateCommand = new Command("validate")
  .description("Lab-Tasks anzeigen oder eine einzelne validieren")
  .argument("[task_slug]", "Task-Slug (Optional — ohne Slug: Task-Liste anzeigen)")
  .action(async (taskSlug?: string) => {
    if (!taskSlug) {
      // List-Modus — nützlich nach Detach aus der VM um zu sehen, was
      // noch zu tun ist.
      try {
        const ctx = await loadActiveLesson();
        if (!ctx) return;
        renderTaskList(ctx.detail);
      } catch (err) {
        printError(err);
      }
      return;
    }

    const spinner = ora(`Validiere "${taskSlug}"…`).start();
    try {
      const ctx = await loadActiveLesson();
      if (!ctx) {
        spinner.stop();
        return;
      }
      const tasks = ctx.detail.tasks ?? [];
      const task = tasks.find((t) => t.slug === taskSlug);
      if (!task) {
        spinner.stop();
        ui.error(`Task "${taskSlug}" nicht in Lesson "${ctx.lessonSlug}" gefunden.`);
        ui.info(`Verfügbare Tasks: ${tasks.map((t) => t.slug).join(", ") || "—"}`);
        return;
      }

      const valResp = await api.post<ValidateResponse>(
        `/api/lab/sessions/${ctx.sid}/validate`,
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
      // ANSI-Schutz: alle Backend-Strings (r.message, d.check, d.hint,
      // d.output) durch safe() — siehe ui.ts safe() Doc-Block.
      if (r.message) console.log(`  ${safe(r.message)}`);
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
          console.log(`  ${mark} ${safe(d.check ?? "")}`);
          if (d.hint) console.log(`    ${ui.dim("Hint: " + safe(d.hint))}`);
          if (d.output && !d.passed) {
            // safe() vor slice damit ANSI-Sequenzen sauber entfernt sind
            // bevor wir auf 200 Zeichen kuerzen (sonst koennte ein halber
            // Escape-Code uebrigbleiben).
            const cleaned = safe(d.output);
            const trimmed = cleaned.length > 200 ? cleaned.slice(0, 200) + "…" : cleaned;
            console.log(`    ${ui.dim(trimmed)}`);
          }
        }
      }
      console.log("");

      // Bei Erfolg: Hinweis was als nächstes ansteht.
      if (r.passed) {
        const idx = tasks.findIndex((t) => t.slug === taskSlug);
        const next = idx >= 0 && idx + 1 < tasks.length ? tasks[idx + 1] : null;
        if (next) {
          console.log(ui.dim(`Nächste Aufgabe: ${ui.cyan(next.slug)}`));
        }
      }
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

// Eigenständiger `lab tasks`-Alias damit User intuitiv listen können,
// ohne den `validate`-Term zu kennen. Reuse derselben Render-Logik.
export const tasksCommand = new Command("tasks")
  .description("Aufgaben der aktuellen Lab-Session anzeigen (mit Bestanden-Status)")
  .action(async () => {
    try {
      const ctx = await loadActiveLesson();
      if (!ctx) return;
      renderTaskList(ctx.detail);
    } catch (err) {
      printError(err);
    }
  });
