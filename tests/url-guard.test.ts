import { describe, expect, it } from "vitest";
import { assertSafeApiBaseUrl, isLoopbackHost } from "../src/api/url-guard";

describe("isLoopbackHost", () => {
  it("erkennt localhost / 127.0.0.1 / ::1", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });
  it("ist false fuer echte Hosts", () => {
    for (const h of ["techlogia.de", "evil.com", "127.0.0.1.evil.com"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("assertSafeApiBaseUrl (Token-Exfil-Schutz)", () => {
  it("erlaubt https zu techlogia.de", () => {
    expect(() => assertSafeApiBaseUrl("https://techlogia.de")).not.toThrow();
  });

  it("erlaubt https zu einem Fremd-Host (Dev/Staging, verschluesselt)", () => {
    expect(() => assertSafeApiBaseUrl("https://staging.techlogia.de")).not.toThrow();
  });

  it("erlaubt http NUR fuer localhost/Loopback", () => {
    expect(() => assertSafeApiBaseUrl("http://localhost:8000")).not.toThrow();
    expect(() => assertSafeApiBaseUrl("http://127.0.0.1:8000")).not.toThrow();
  });

  it("LEHNT http zu einem Nicht-Loopback-Host AB (Klartext-Token)", () => {
    expect(() => assertSafeApiBaseUrl("http://evil.com")).toThrow(/http.*Klartext|https/i);
    expect(() => assertSafeApiBaseUrl("http://techlogia.de")).toThrow();
  });

  it("lehnt Nicht-http/https-Schemata ab", () => {
    expect(() => assertSafeApiBaseUrl("file:///etc/passwd")).toThrow(/Schema/i);
    expect(() => assertSafeApiBaseUrl("ftp://techlogia.de")).toThrow(/Schema/i);
  });

  it("lehnt kaputte URLs ab", () => {
    expect(() => assertSafeApiBaseUrl("nicht-eine-url")).toThrow(/ungültig|TECHLOGIA_API/i);
  });

  it("die Fehlermeldung enthaelt keine rohen ANSI/Control-Bytes (safe())", () => {
    try {
      assertSafeApiBaseUrl("http://ev[31mil.com");
      expect.unreachable("sollte werfen");
    } catch (e) {
      expect((e as Error).message).not.toContain("");
    }
  });
});
