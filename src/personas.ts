import { AuthMeResponse, UserRole } from "./api/types";

// Persona-Definition spiegelt Backend-Rollen (siehe backend/app/models/user.py
// UserRole). Wir derivieren clientseitig welche Befehl-Namespaces sichtbar
// sind — REIN UI-Filter; Server bleibt Source-of-Truth für Authorization
// (Backend wirft 403 wenn die CLI doch was Falsches schickt).

export type PersonaKind =
  | "anonymous"
  | "learner"
  | "student" // Klassen-Code-Lerner (Email-Login geht nicht)
  | "teacher"
  | "school_admin"
  | "editor"
  | "viewer"
  | "admin";

export interface Persona {
  kind: PersonaKind;
  label: string;
  description: string;
  // Erlaubte Top-Level-Command-Namespaces (entspricht Commander-Subcommands).
  // "public"-Befehle (health/blog/legal) sind IMMER erlaubt.
  allowedCommands: ReadonlyArray<string>;
}

const PUBLIC_COMMANDS = ["health", "blog", "legal", "login", "logout", "whoami", "config"] as const;

const PERSONAS: Record<PersonaKind, Persona> = {
  anonymous: {
    kind: "anonymous",
    label: "Gast",
    description: "Nicht angemeldet — nur öffentliche Befehle verfügbar.",
    allowedCommands: [...PUBLIC_COMMANDS, "student"],
  },
  learner: {
    kind: "learner",
    label: "Lerner",
    description: "Lernplattform-Nutzer mit Lab-Zugang.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account"],
  },
  student: {
    kind: "student",
    label: "Schüler",
    description: "Schulklasse — eingeschraenkter Lab-Zugang über Klassen-Code.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account"],
  },
  teacher: {
    kind: "teacher",
    label: "Lehrer",
    description: "Verwaltet Klassen, Schüler und Modul-Sichtbarkeit.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account", "class"],
  },
  school_admin: {
    kind: "school_admin",
    label: "Schul-Admin",
    description: "Verwaltet Lehrer und Klassen einer Schule.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account", "class", "school"],
  },
  editor: {
    kind: "editor",
    label: "Redakteur",
    description: "Pflegt Blog-, Legal- und Lab-Inhalte.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account", "admin"],
  },
  viewer: {
    kind: "viewer",
    label: "Viewer",
    description: "Read-only-Zugriff auf das Admin-Panel.",
    allowedCommands: [...PUBLIC_COMMANDS, "account", "admin"],
  },
  admin: {
    kind: "admin",
    label: "Plattform-Admin",
    description: "Volle Verwaltung von Techlogia.",
    allowedCommands: [...PUBLIC_COMMANDS, "lab", "account", "class", "school", "admin"],
  },
};

export function getPersonaForUser(me: AuthMeResponse | null): Persona {
  if (!me) return PERSONAS.anonymous;
  // Schüler-Sonderfall: student_class_id != null UND role == learner.
  // Diese User können sich nicht per Email einloggen (Pseudo-Email
  // "student-<id>@class-<code>.local"), Catalog ist whitelist-gefiltert.
  if (me.role === "learner" && me.student_class_id != null) {
    return PERSONAS.student;
  }
  const byRole: Record<UserRole, Persona> = {
    admin: PERSONAS.admin,
    editor: PERSONAS.editor,
    viewer: PERSONAS.viewer,
    learner: PERSONAS.learner,
    teacher: PERSONAS.teacher,
    school_admin: PERSONAS.school_admin,
  };
  return byRole[me.role] ?? PERSONAS.anonymous;
}

export function getAllPersonas(): ReadonlyArray<Persona> {
  return Object.values(PERSONAS);
}

export function isCommandAllowed(persona: Persona, command: string): boolean {
  return persona.allowedCommands.includes(command);
}
