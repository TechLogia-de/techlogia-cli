import { Command } from "commander";
import { marked } from "marked";
// @ts-expect-error - marked-terminal hat keine eigenen TS-Types fuer v7
import { markedTerminal } from "marked-terminal";
import { apiAnon } from "../api/client";
import { LegalDocument, pickLocaleText } from "../api/types";
import { config } from "../config";
import { formatDate, printError, ui } from "../ui";

marked.use(markedTerminal() as never);

const KNOWN_SLUGS = ["impressum", "datenschutz", "agb", "widerruf"];

export const legalCommand = new Command("legal").description(
  "Rechtstexte anzeigen (Impressum, Datenschutz, AGB)",
);

legalCommand
  .command("list")
  .description("Verfuegbare Rechtsdokumente")
  .action(() => {
    console.log("");
    console.log(ui.bold("Rechtsdokumente"));
    console.log("");
    for (const slug of KNOWN_SLUGS) {
      console.log(`  ${ui.cyan(slug.padEnd(15))} techlogia legal show ${slug}`);
    }
    console.log("");
  });

legalCommand
  .command("show <slug>")
  .description("Ein Rechtsdokument anzeigen (z.B. impressum, datenschutz, agb)")
  .action(async (slug: string) => {
    try {
      const resp = await apiAnon.get<LegalDocument>(`/api/legal/${slug}`);
      const doc = resp.data;
      const docRec = doc as unknown as Record<string, unknown>;
      const title = pickLocaleText(docRec, "title", config.get("locale")) ?? doc.type ?? slug.toUpperCase();
      console.log("");
      console.log(ui.bold(title));
      const versionMeta = [doc.version ? `Version ${doc.version}` : null, doc.updated_at ? `Stand ${formatDate(doc.updated_at)}` : null]
        .filter(Boolean)
        .join(" · ");
      if (versionMeta) console.log(ui.dim(versionMeta));
      console.log(ui.dim("─".repeat(60)));
      console.log("");
      const body =
        pickLocaleText(docRec, "content", config.get("locale")) ??
        doc.content_markdown ??
        doc.content_html ??
        "";
      console.log(await marked.parse(body));
    } catch (err) {
      printError(err);
    }
  });
