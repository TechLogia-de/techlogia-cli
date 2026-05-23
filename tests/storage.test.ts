import { describe, expect, it } from "vitest";
import { storageBackend } from "../src/api/storage";

describe("storageBackend", () => {
  it("liefert keychain oder file-encrypted je nach keytar-Verfuegbarkeit", () => {
    const backend = storageBackend();
    expect(["keychain", "file-encrypted"]).toContain(backend);
  });
});
