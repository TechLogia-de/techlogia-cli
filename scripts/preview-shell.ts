// Preview-Helper: rendert das neue Welcome + ein Prompt-Sample mit
// Dummy-Daten, damit man die UI sehen kann ohne TTY-Shell zu starten.
import { renderWelcome, buildPrompt, renderHelpBox } from "../src/banner";
import type { AuthMeResponse, LabSession } from "../src/api/types";
import type { Persona } from "../src/personas";

const me: AuthMeResponse = {
  id: 25,
  email: "student-25@class-1.local",
  username: "student-25@class-1.local",
  display_name: "Ben B.",
  role: "learner",
  is_active: true,
  student_class_id: 1,
  xp_total: 240,
};

const persona: Persona = {
  kind: "student",
  label: "Schueler",
  description: "Schulklasse — eingeschraenkter Lab-Zugang ueber Klassen-Code.",
  allowedCommands: ["health", "blog", "legal", "login", "logout", "whoami", "config", "lab", "account"],
};

const activeSession: LabSession = {
  session_id: "bdaadbf4-e8e4-44b7-ad23-8b405aefbb00",
  status: "READY",
  vm_ipv4: "188.245.168.171",
  lesson_slug: "validator-tour",
  lesson_title: { de: "Validator-Rundgang", en: "Validator Tour" },
  cost_per_hour_eur: 0.29,
};

console.log(renderWelcome({ me, persona, activeSession, version: "0.2.1" }));
console.log(buildPrompt({ me, persona, activeSession }));
console.log("(... waere hier dein Eingabe-Cursor)");
console.log("");
console.log(renderHelpBox(persona));
