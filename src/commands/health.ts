import { Command } from "commander";
import { apiAnon, CLI_VERSION, USER_AGENT } from "../api/client";
import { getApiBaseUrl } from "../config";
import { getAccessToken, storageBackend } from "../api/storage";
import { api } from "../api/client";
import { AuthMeResponse } from "../api/types";
import { getPersonaForUser } from "../personas";
import { printError, ui } from "../ui";

export const healthCommand = new Command("health")
  .description("Pruefen ob die Techlogia-API erreichbar ist")
  .action(async () => {
    try {
      const t0 = Date.now();
      const resp = await apiAnon.get<{ status?: string; version?: string }>("/api/health");
      const elapsed = Date.now() - t0;
      ui.success(`API erreichbar (${elapsed}ms): ${getApiBaseUrl()}`);
      if (resp.data.version) console.log(`  Backend-Version: ${ui.dim(resp.data.version)}`);
      if (resp.data.status) console.log(`  Status: ${ui.dim(resp.data.status)}`);
    } catch (err) {
      printError(err);
    }
  });

export const statusCommand = new Command("status")
  .description("Lokalen Status zeigen: CLI-Version, API-Erreichbarkeit, eingeloggte Persona")
  .action(async () => {
    console.log("");
    console.log(ui.bold("Techlogia CLI"));
    console.log(`  Version       : ${CLI_VERSION}`);
    console.log(`  API           : ${getApiBaseUrl()}`);
    console.log(`  Token-Speicher: ${storageBackend()}`);
    console.log(`  User-Agent    : ${ui.dim(USER_AGENT)}`);

    const token = await getAccessToken();
    if (!token) {
      console.log(`  Login         : ${ui.dim("nicht angemeldet")}`);
      console.log("");
      return;
    }

    try {
      const me = (await api.get<AuthMeResponse>("/api/auth/me")).data;
      const persona = getPersonaForUser(me);
      console.log(`  Angemeldet als: ${me.email}`);
      console.log(`  Persona       : ${ui.cyan(persona.label)}`);
    } catch {
      console.log(`  Login         : ${ui.yellow("Token vorhanden, Server-Check fehlgeschlagen")}`);
    }
    console.log("");
  });
