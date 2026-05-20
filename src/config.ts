import Conf from "conf";

// Persistente Konfiguration unter ~/Library/Preferences/techlogia-nodejs/ (macOS)
// bzw. ~/.config/techlogia-nodejs/ (Linux). conf legt das File automatisch an
// und macht atomic writes — kein Halb-Schreiben bei Strg+C.
export const config = new Conf<{
  apiBaseUrl: string;
  locale: "de" | "en";
  lastEmail?: string;
}>({
  projectName: "techlogia",
  defaults: {
    // Default zeigt auf Prod — kann via TECHLOGIA_API ueberschrieben werden
    // (Dev-Setups + CI). Nie auf localhost defaulten, sonst verwirrt der
    // erste "techlogia health" jeden frisch installierten User.
    apiBaseUrl: "https://techlogia.de",
    locale: "de",
  },
});

export function getApiBaseUrl(): string {
  // ENV-Override gewinnt — fuer Staging/Tests ohne Config-Edit.
  return process.env.TECHLOGIA_API ?? config.get("apiBaseUrl");
}
