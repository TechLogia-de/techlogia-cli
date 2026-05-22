import { describe, expect, it } from "vitest";
import { safe } from "../src/ui";

// P1 ANSI-Sanitizer — Tests gegen die Klassen von Angriffen die im
// Senior-Audit benannt wurden (Codex-CLI-RCE-Klasse, OSC-52-Clipboard-
// Hijack, prompt-injection via CSI/SGR).

describe("safe()", () => {
  it("laesst harmlose Strings unveraendert durch", () => {
    expect(safe("Hallo Welt")).toBe("Hallo Welt");
    expect(safe("Mit Umlauten: ä ö ü ß")).toBe("Mit Umlauten: ä ö ü ß");
    expect(safe("Newlines\nund\tTabs")).toBe("Newlines\nund\tTabs");
  });

  it("entfernt CSI-Sequenzen (Cursor-/Color-Manipulation)", () => {
    // ESC[31m  = SGR rot setzen. ESC[0m = reset.
    expect(safe("\x1b[31mrot\x1b[0m")).toBe("rot");
    expect(safe("\x1b[2J")).toBe(""); // Clear screen
    expect(safe("\x1b[H")).toBe(""); // Cursor home
  });

  it("entfernt OSC-52 (Clipboard-Hijack)", () => {
    // OSC 52 ; c ; <base64> BEL — schreibt in System-Clipboard
    expect(safe("\x1b]52;c;cm0gLXJmIC8=\x07")).toBe("");
    // Auch mit ST-Terminator (ESC\\) statt BEL
    expect(safe("\x1b]52;c;data\x1b\\")).toBe("");
  });

  it("entfernt OSC-Hyperlinks (OSC 8) die als Display-Text taeuschen koennen", () => {
    // OSC 8 ;; URL ST text OSC 8 ;; ST — fake-Link der woanders hin geht
    const fake = "\x1b]8;;https://evil.example\x07Click here\x1b]8;;\x07";
    expect(safe(fake)).toBe("Click here");
  });

  it("entfernt DCS/SOS/PM/APC (rarely used, dangerous)", () => {
    expect(safe("\x1bPmydata\x1b\\")).toBe("");
    expect(safe("\x1bXdata\x1b\\")).toBe("");
    expect(safe("\x1b^data\x1b\\")).toBe("");
    expect(safe("\x1b_data\x1b\\")).toBe("");
  });

  it("entfernt BEL und sonstige C0-Steuerzeichen ausser \\n und \\t", () => {
    expect(safe("ding\x07dong")).toBe("dingdong"); // BEL
    expect(safe("a\x00b")).toBe("ab"); // NUL
    expect(safe("a\x08b")).toBe("ab"); // Backspace
    expect(safe("a\x7Fb")).toBe("ab"); // DEL
  });

  it("kuerzt pathologisch lange Strings auf maxLen", () => {
    const huge = "x".repeat(10000);
    const out = safe(huge, 100);
    expect(out.length).toBe(101); // 100 chars + Ellipsis-Zeichen
    expect(out.endsWith("…")).toBe(true);
  });

  it("haelt null/undefined ab ohne crash", () => {
    expect(safe(null)).toBe("");
    expect(safe(undefined)).toBe("");
    expect(safe(42)).toBe("42"); // coercion ist OK
  });

  it("entfernt verschachtelte ANSI-Sequenzen vollstaendig", () => {
    const mixed =
      "Normal text \x1b[1m\x1b[31mbold-red\x1b[0m mehr text \x1b]52;c;evil\x07ende";
    expect(safe(mixed)).toBe("Normal text bold-red mehr text ende");
  });
});
