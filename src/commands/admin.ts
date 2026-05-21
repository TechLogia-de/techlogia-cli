import { Command } from "commander";
import ora from "ora";
import { api } from "../api/client";
import { printError, ui } from "../ui";

// Admin-Subcommands sind bewusst MINIMAL — der volle Admin-Workflow lebt
// im Web-Panel (90% der Verwaltung). Die CLI gibt nur die Top-Operations:
// users-list, dashboard, lab-stats — für schnelle Health-Checks von der
// Konsole ohne Browser-Login.

export const adminCommand = new Command("admin").description(
  "Plattform-Admin: schnelle Read-Operationen (volle Verwaltung im Web)",
);

adminCommand
  .command("dashboard")
  .description("Admin-Dashboard-Kennzahlen anzeigen")
  .action(async () => {
    const spinner = ora("Lade Dashboard...").start();
    try {
      const resp = await api.get<Record<string, unknown>>("/api/admin/dashboard");
      spinner.stop();
      console.log("");
      console.log(ui.bold("Admin-Dashboard"));
      console.log(ui.dim("─".repeat(60)));
      // Generisch rendern, weil das Dashboard-Schema sich oft erweitert.
      // Wir geben alle top-level numeric/string Felder aus.
      for (const [k, v] of Object.entries(resp.data)) {
        if (v == null) continue;
        if (typeof v === "object") {
          console.log(`  ${k}:`);
          for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
            console.log(`    ${k2.padEnd(20)} ${ui.cyan(String(v2))}`);
          }
        } else {
          console.log(`  ${k.padEnd(22)} ${ui.cyan(String(v))}`);
        }
      }
      console.log("");
    } catch (err) {
      spinner.stop();
      printError(err);
    }
  });

adminCommand
  .command("users")
  .description("Letzte Nutzer auflisten")
  .option("-n, --limit <n>", "Anzahl", "20")
  .action(async (opts: { limit: string }) => {
    try {
      const resp = await api.get<{ users?: Array<{ id: number; email: string; role: string; is_active: boolean }> }>(
        `/api/admin/users?limit=${parseInt(opts.limit, 10) || 20}`,
      );
      const users = resp.data.users ?? [];
      if (users.length === 0) {
        ui.info("Keine Nutzer.");
        return;
      }
      console.log("");
      console.log(ui.bold(`${users.length} Nutzer`));
      console.log(ui.dim("─".repeat(60)));
      for (const u of users) {
        const active = u.is_active ? ui.green("●") : ui.red("●");
        console.log(`  ${active} #${u.id.toString().padEnd(6)} ${u.email.padEnd(40)} ${ui.cyan(u.role)}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });

adminCommand
  .command("lab-stats")
  .description("Lab-Plattform-Statistiken")
  .action(async () => {
    try {
      const resp = await api.get<Record<string, unknown>>("/api/admin/lab/stats");
      console.log("");
      console.log(ui.bold("Lab-Statistiken"));
      console.log(ui.dim("─".repeat(60)));
      for (const [k, v] of Object.entries(resp.data)) {
        console.log(`  ${k.padEnd(28)} ${ui.cyan(String(v))}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
