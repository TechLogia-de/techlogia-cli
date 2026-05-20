import { Command } from "commander";
import { marked } from "marked";
// @ts-expect-error - marked-terminal hat keine eigenen TS-Types fuer v7
import { markedTerminal } from "marked-terminal";
import { apiAnon } from "../api/client";
import { BlogPost, pickLocaleText } from "../api/types";
import { config } from "../config";
import { formatDate, printError, ui } from "../ui";

marked.use(markedTerminal() as never);

function blogTitle(p: BlogPost): string {
  return pickLocaleText(p as unknown as Record<string, unknown>, "title", config.get("locale")) ?? p.slug ?? "(ohne Titel)";
}

function blogBody(p: BlogPost): string {
  // Backend liefert content_de/content_en als HTML. marked rendert HTML
  // nicht parse-bar zurueck nach Markdown — wir reichen es trotzdem an
  // marked weil das Terminal-Renderer die <h*>, <pre>, <code>-Tags
  // erkennt und passend einfaerbt. Plain-Text-Fallback fuer Excerpts.
  return (
    pickLocaleText(p as unknown as Record<string, unknown>, "content", config.get("locale")) ??
    pickLocaleText(p as unknown as Record<string, unknown>, "excerpt", config.get("locale")) ??
    p.content_markdown ??
    p.content_html ??
    p.excerpt ??
    ""
  );
}

export const blogCommand = new Command("blog").description("Blog-Beitraege lesen (kein Login noetig)");

blogCommand
  .command("list")
  .description("Letzte Blog-Beitraege auflisten")
  .option("-n, --limit <n>", "Anzahl", "10")
  .action(async (opts: { limit: string }) => {
    try {
      const limit = parseInt(opts.limit, 10) || 10;
      const resp = await apiAnon.get<{ posts?: BlogPost[] } | BlogPost[]>(
        `/api/blog?limit=${limit}`,
      );
      const posts: BlogPost[] = Array.isArray(resp.data) ? resp.data : resp.data.posts ?? [];

      if (posts.length === 0) {
        ui.info("Keine Blog-Beitraege gefunden.");
        return;
      }

      console.log("");
      console.log(ui.bold(`Blog — letzte ${posts.length} Beitraege`));
      console.log(ui.dim("─".repeat(60)));
      for (const p of posts) {
        console.log(`${ui.cyan("●")} ${ui.bold(blogTitle(p))}`);
        const slug = p.slug ?? "(kein slug)";
        console.log(`  ${ui.dim(slug)} · ${ui.dim(formatDate(p.published_at))}`);
        const excerpt = pickLocaleText(p as unknown as Record<string, unknown>, "excerpt", config.get("locale"));
        if (excerpt) console.log(`  ${ui.dim(excerpt.slice(0, 120))}`);
        console.log("");
      }
      console.log(ui.dim("Lesen: ") + ui.cyan("techlogia blog read <slug>"));
    } catch (err) {
      printError(err);
    }
  });

blogCommand
  .command("read <slug>")
  .description("Einen Blog-Beitrag im Terminal lesen (HTML/Markdown-Render)")
  .action(async (slug: string) => {
    try {
      const resp = await apiAnon.get<BlogPost>(`/api/blog/${slug}`);
      const post = resp.data;
      console.log("");
      console.log(ui.bold(blogTitle(post)));
      const meta = [post.author, formatDate(post.published_at)].filter(Boolean).join(" · ");
      if (meta) console.log(ui.dim(meta));
      console.log(ui.dim("─".repeat(60)));
      console.log("");
      const body = blogBody(post);
      console.log(await marked.parse(body));
    } catch (err) {
      printError(err);
    }
  });
