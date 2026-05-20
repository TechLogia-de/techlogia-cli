import { Command } from "commander";
import { api } from "../api/client";
import { AuthMeResponse } from "../api/types";
import { formatDate, printError, ui } from "../ui";

export const accountCommand = new Command("account").description("Eigenes Konto verwalten");

accountCommand
  .command("profile")
  .description("Eigenes Profil anzeigen")
  .action(async () => {
    try {
      const me = (await api.get<AuthMeResponse>("/api/auth/me")).data;
      console.log("");
      console.log(ui.bold("Konto-Profil"));
      console.log(ui.dim("─".repeat(60)));
      console.log(`  Email          : ${me.email}`);
      console.log(`  Benutzername   : ${me.username}`);
      console.log(`  Anzeigename    : ${me.display_name ?? ui.dim("—")}`);
      console.log(`  Rolle          : ${me.role}`);
      console.log(`  MFA            : ${me.mfa_enabled ? ui.green("aktiviert") : ui.dim("aus")}`);
      if (me.oauth_provider) console.log(`  Login-Provider : ${me.oauth_provider}`);
      if (me.xp_total != null) {
        const level = Math.floor(Math.sqrt(me.xp_total / 100));
        console.log(`  XP             : ${me.xp_total} (Level ${level})`);
      }
      if (me.lab_agb_accepted_version) {
        console.log(`  Lab-AGB        : ${me.lab_agb_accepted_version}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });

accountCommand
  .command("xp")
  .description("Eigenen XP-Stand + Level anzeigen")
  .action(async () => {
    try {
      const me = (await api.get<AuthMeResponse>("/api/auth/me")).data;
      const xp = me.xp_total ?? 0;
      const level = Math.floor(Math.sqrt(xp / 100));
      const nextLevel = (level + 1) * (level + 1) * 100;
      const remaining = nextLevel - xp;
      console.log("");
      console.log(ui.bold("XP-Stand"));
      console.log(`  Aktuell        : ${ui.cyan(String(xp))} XP`);
      console.log(`  Level          : ${ui.green(String(level))}`);
      console.log(`  Bis Level ${level + 1}   : ${remaining} XP fehlen`);
      console.log("");
      console.log(ui.dim("XP gibt es fuer jede erste Task-Erfuellung (+20 XP)."));
    } catch (err) {
      printError(err);
    }
  });

accountCommand
  .command("session-history")
  .description("Vergangene Lab-Sessions zeigen")
  .option("-n, --limit <n>", "Anzahl", "10")
  .action(async (opts: { limit: string }) => {
    try {
      const limit = parseInt(opts.limit, 10) || 10;
      const resp = await api.get<{ sessions?: Array<{ id: number | string; status: string; module_slug?: string; started_at?: string; ended_at?: string }> }>(
        `/api/lab/account/sessions?limit=${limit}`,
      );
      const sessions = resp.data.sessions ?? [];
      if (sessions.length === 0) {
        ui.info("Keine Session-Historie.");
        return;
      }
      console.log("");
      console.log(ui.bold(`Letzte ${sessions.length} Sessions`));
      console.log(ui.dim("─".repeat(60)));
      for (const s of sessions) {
        console.log(`  #${s.id} [${ui.cyan(s.status)}] ${s.module_slug ?? ui.dim("—")}`);
        console.log(`    ${formatDate(s.started_at)} → ${formatDate(s.ended_at)}`);
      }
      console.log("");
    } catch (err) {
      printError(err);
    }
  });
