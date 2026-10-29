import { describe, expect, it } from "vitest";
import { oauthProviderLabel } from "../src/ui";

// CodeQL js/clear-text-logging (#1/#2): Ausgabe nur aus fester Allowlist.

describe("oauthProviderLabel()", () => {
  it("gibt bekannte Anbieter unveraendert aus", () => {
    for (const p of ["google", "github", "apple", "eduplaces"]) {
      expect(oauthProviderLabel(p)).toBe(p);
    }
  });

  it("zeigt unbekannte oder manipulierte Werte generisch an", () => {
    expect(oauthProviderLabel("evil\x1b]52;c;x\x07")).toBe("externer Anbieter");
    expect(oauthProviderLabel("")).toBe("externer Anbieter");
    expect(oauthProviderLabel(null)).toBe("externer Anbieter");
    expect(oauthProviderLabel(undefined)).toBe("externer Anbieter");
  });
});
