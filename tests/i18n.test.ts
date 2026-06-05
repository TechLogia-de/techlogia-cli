import { describe, expect, it } from "vitest";
import { authorName, pickLocaleText } from "../src/api/types";

describe("pickLocaleText (i18n-Helper fuer Backend-Felder)", () => {
  it("waehlt content_de wenn locale=de", () => {
    const o = { content_de: "Hallo", content_en: "Hello" };
    expect(pickLocaleText(o, "content", "de")).toBe("Hallo");
  });

  it("waehlt content_en wenn locale=en", () => {
    const o = { content_de: "Hallo", content_en: "Hello" };
    expect(pickLocaleText(o, "content", "en")).toBe("Hello");
  });

  it("faellt auf andere Sprache zurueck wenn primary leer", () => {
    const o = { content_de: "", content_en: "Hello" };
    expect(pickLocaleText(o, "content", "de")).toBe("Hello");
  });

  it("nimmt plain field wenn beide locale-varianten fehlen", () => {
    const o = { content: "Plain" };
    expect(pickLocaleText(o, "content", "de")).toBe("Plain");
  });

  it("liefert undefined wenn nichts da ist", () => {
    expect(pickLocaleText({}, "content", "de")).toBeUndefined();
  });

  it("ignoriert nicht-string Werte", () => {
    const o = { content_de: 42, content_en: null };
    expect(pickLocaleText(o as Record<string, unknown>, "content", "de")).toBeUndefined();
  });
});

// Schema-Drift-Regression (Audit 2026-06-05): Live-API liefert author als
// Objekt {username, display_name}, aelteres Schema als String. Ohne den
// Helper renderte `blog read` ein "[object Object]" in der Meta-Zeile.
describe("authorName (Blog-Autor aus beiden API-Schemata)", () => {
  it("reicht einen String-Autor unveraendert durch", () => {
    expect(authorName("Antonio")).toBe("Antonio");
  });

  it("bevorzugt display_name beim Objekt-Schema", () => {
    expect(authorName({ username: "j.ruiz", display_name: "Antonio" })).toBe("Antonio");
  });

  it("faellt auf username zurueck wenn display_name null ist", () => {
    expect(authorName({ username: "j.ruiz", display_name: null })).toBe("j.ruiz");
  });

  it("gibt undefined zurueck wenn author fehlt (filter(Boolean)-Vertrag)", () => {
    expect(authorName(undefined)).toBeUndefined();
  });

  it("gibt undefined zurueck wenn Objekt leer ist", () => {
    expect(authorName({})).toBeUndefined();
  });
});
