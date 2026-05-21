import { Command } from "commander";
import prompts from "prompts";
import ora from "ora";
import { api } from "../api/client";
import { LabSession, sessionId } from "../api/types";
import { printError, ui } from "../ui";

// `techlogia feedback` — Bug/Idee/Lob direkt aus der CLI ans Backend
// schicken (POST /api/lab/feedback). Wenn der User gerade in einer Session
// ist, taggen wir die session_id mit — dann landet das Feedback bei uns
// im Admin-Bereich neben dem konkreten Modul-Kontext.
//
// Rate-Limit: Backend erlaubt 10 Submissions pro Tag pro User. Die Antwort
// enthält submissions_remaining_today — das zeigen wir an damit der User
// weiß wann er aufhören muss zu spammen.

const CATEGORIES = [
  { value: "bug", label: "Bug — etwas funktioniert nicht" },
  { value: "suggestion", label: "Idee / Vorschlag" },
  { value: "praise", label: "Lob — etwas gefällt mir" },
  { value: "other", label: "Sonstiges" },
];

interface FeedbackResponse {
  detail: string;
  submissions_remaining_today: number;
}

export const feedbackCommand = new Command("feedback")
  .description("Feedback ans Techlogia-Team senden (Bug, Idee, Lob)")
  .option("-c, --category <cat>", "bug | suggestion | praise | other")
  .option("-m, --message <text>", "Direkter Text statt interaktiv")
  .action(async (opts: { category?: string; message?: string }) => {
    // Interaktiv ergänzen was via Flags fehlt — CI kann mit -c/-m alles vorgeben.
    let category = opts.category;
    if (category && !CATEGORIES.some((c) => c.value === category)) {
      ui.error(`Ungültige Kategorie: ${category}`);
      ui.info("Erlaubt: " + CATEGORIES.map((c) => c.value).join(", "));
      return;
    }

    if (!category) {
      const a = await prompts({
        type: "select",
        name: "category",
        message: "Was für ein Feedback?",
        choices: CATEGORIES.map((c) => ({ title: c.label, value: c.value })),
      });
      if (!a.category) {
        ui.warn("Abgebrochen.");
        return;
      }
      category = a.category;
    }

    let message = opts.message;
    if (!message) {
      const a = await prompts({
        type: "text",
        name: "message",
        message: "Dein Feedback (mindestens 5 Zeichen)",
        validate: (v: string) =>
          v.length < 5 ? "mindestens 5 Zeichen" : v.length > 2000 ? "maximal 2000 Zeichen" : true,
      });
      if (!a.message) {
        ui.warn("Abgebrochen.");
        return;
      }
      message = a.message;
    }

    // Session-ID mitschicken wenn aktiv — gibt dem Admin Kontext.
    let sessionContext: string | undefined;
    try {
      const sessResp = await api.get<LabSession | null>("/api/lab/sessions/active");
      if (sessResp.data) {
        sessionContext = sessionId(sessResp.data) ?? undefined;
      }
    } catch {
      // active-Endpoint fehlgeschlagen — nicht blockieren, Feedback ist
      // auch ohne Session-Kontext sinnvoll.
    }

    const spinner = ora("Sende Feedback…").start();
    try {
      const resp = await api.post<FeedbackResponse>("/api/lab/feedback", {
        message,
        category,
        session_id: sessionContext,
        page_url: "techlogia-cli",
      });
      spinner.stop();
      ui.success("Vielen Dank! " + resp.data.detail);
      console.log(
        ui.dim(
          `  Heute noch ${resp.data.submissions_remaining_today} weitere Feedback-Submissions möglich.`,
        ),
      );
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });
