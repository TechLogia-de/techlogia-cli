import { describe, expect, it } from "vitest";
import { pickLocaleText } from "../src/api/types";

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
