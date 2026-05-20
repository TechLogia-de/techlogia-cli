import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";
import { apiAnon } from "../api/client";
import { saveTokens, storageBackend } from "../api/storage";
import { TokenResponse } from "../api/types";
import { printError, ui } from "../ui";

export const studentCommand = new Command("student").description(
  "Schueler-Login per Klassen-Code (kein Email-Passwort)",
);

studentCommand
  .command("login")
  .description("Anmelden mit Klassen-Code + Login-Name")
  .option("-c, --code <code>", "Klassen-Code (z.B. ABCD-1234)")
  .option("-n, --name <name>", "Schueler-Login-Name")
  .action(async (opts: { code?: string; name?: string }) => {
    try {
      const responses = await prompts([
        {
          type: opts.code ? null : "text",
          name: "code",
          message: "Klassen-Code",
          validate: (v: string) => (v.length >= 4 ? true : "Mindestens 4 Zeichen"),
        },
        {
          type: opts.name ? null : "text",
          name: "name",
          message: "Dein Login-Name",
          validate: (v: string) => (v.length >= 2 ? true : "Mindestens 2 Zeichen"),
        },
      ]);
      const code = opts.code ?? responses.code;
      const name = opts.name ?? responses.name;
      if (!code || !name) return;

      const spinner = ora("Melde an...").start();
      // Backend-Endpoint: POST /api/auth/student/login
      // Body: { class_code, student_login_name }
      const resp = await apiAnon.post<TokenResponse>("/api/auth/student/login", {
        class_code: code,
        student_login_name: name,
      });
      spinner.stop();

      await saveTokens(resp.data.access_token, resp.data.refresh_token);
      ui.success(`Hallo ${ui.bold(name)}! Du bist eingeloggt.`);
      console.log(`  Token-Speicher: ${ui.dim(storageBackend())}`);
      console.log("");
      console.log(ui.dim("Tipp: ") + ui.cyan("techlogia lab modules") + ui.dim(" zeigt deine Module."));
    } catch (err) {
      printError(err);
    }
  });
