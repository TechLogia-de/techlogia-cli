import { describe, expect, it } from "vitest";
import { getPersonaForUser, isCommandAllowed } from "../src/personas";
import type { AuthMeResponse } from "../src/api/types";

describe("Persona-Routing", () => {
  it("anonymous wenn me=null", () => {
    const p = getPersonaForUser(null);
    expect(p.kind).toBe("anonymous");
    expect(p.allowedCommands).toContain("blog");
    expect(p.allowedCommands).not.toContain("admin");
    expect(p.allowedCommands).not.toContain("lab");
  });

  it("learner mit Email-Login sieht lab, nicht class/school/admin", () => {
    const me: AuthMeResponse = {
      id: 1,
      email: "u@x.de",
      username: "u",
      role: "learner",
      is_active: true,
      student_class_id: null,
    };
    const p = getPersonaForUser(me);
    expect(p.kind).toBe("learner");
    expect(isCommandAllowed(p, "lab")).toBe(true);
    expect(isCommandAllowed(p, "class")).toBe(false);
    expect(isCommandAllowed(p, "admin")).toBe(false);
  });

  it("student-Sonderfall: learner-Rolle mit student_class_id != null", () => {
    const me: AuthMeResponse = {
      id: 2,
      email: "student-2@class-XY.local",
      username: "alice",
      role: "learner",
      is_active: true,
      student_class_id: 42,
    };
    const p = getPersonaForUser(me);
    expect(p.kind).toBe("student");
    expect(isCommandAllowed(p, "lab")).toBe(true);
  });

  it("teacher sieht class aber nicht school", () => {
    const me: AuthMeResponse = {
      id: 3,
      email: "t@x.de",
      username: "t",
      role: "teacher",
      is_active: true,
    };
    const p = getPersonaForUser(me);
    expect(p.kind).toBe("teacher");
    expect(isCommandAllowed(p, "class")).toBe(true);
    expect(isCommandAllowed(p, "school")).toBe(false);
  });

  it("school_admin sieht school + class", () => {
    const me: AuthMeResponse = {
      id: 4,
      email: "sa@x.de",
      username: "sa",
      role: "school_admin",
      is_active: true,
    };
    const p = getPersonaForUser(me);
    expect(p.kind).toBe("school_admin");
    expect(isCommandAllowed(p, "school")).toBe(true);
    expect(isCommandAllowed(p, "class")).toBe(true);
    expect(isCommandAllowed(p, "admin")).toBe(false);
  });

  it("admin sieht alles", () => {
    const me: AuthMeResponse = {
      id: 5,
      email: "a@x.de",
      username: "a",
      role: "admin",
      is_active: true,
    };
    const p = getPersonaForUser(me);
    expect(p.kind).toBe("admin");
    expect(isCommandAllowed(p, "admin")).toBe(true);
    expect(isCommandAllowed(p, "lab")).toBe(true);
    expect(isCommandAllowed(p, "school")).toBe(true);
  });
});
