import { Command } from "commander";
import WebSocket from "ws";
import { api } from "../api/client";
import { getAccessToken } from "../api/storage";
import { LabSession, sessionId } from "../api/types";
import { getApiBaseUrl } from "../config";
import { printError, ui } from "../ui";

// `lab attach` — bidirektionales Terminal in die laufende Lab-VM, direkt
// im CLI. Spiegelt das Web-Player-Verhalten:
//   - WS-Subprotocol-Auth: ["techlogia.lab.v1", jwt] (Phase 9 D-14)
//   - Stdin -> WS (raw bytes), WS -> Stdout (raw ANSI bytes)
//   - PTY-Resize via JSON-Frame {type:"resize",cols,rows} (Phase 7 _bridge.py)
//   - Detach via Strg+P Strg+Q (analog docker attach) — VM läuft weiter,
//     Sessions können so vom Browser übernommen werden.

const DETACH_SEQUENCE = [0x10, 0x11]; // Ctrl-P, Ctrl-Q

export type AttachResult =
  | { kind: "detach" }
  | { kind: "remote_close"; code: number; reason: string }
  | { kind: "auth_failed" }
  | { kind: "not_ready" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function wsUrlFor(sessionUuid: string): string {
  const base = getApiBaseUrl();
  const wsBase = base.replace(/^http/, "ws");
  // Backend mountet lab.router unter prefix=/api/lab. terminal.py definiert
  // websocket("/ws/terminal/{session_id}") — finale URL ist also
  // /api/lab/ws/terminal/{sid}.
  return `${wsBase}/api/lab/ws/terminal/${sessionUuid}`;
}

async function resolveSession(targetId?: string): Promise<string | null> {
  if (targetId) return targetId;
  const resp = await api.get<LabSession | null>("/api/lab/sessions/active");
  if (!resp.data) return null;
  return sessionId(resp.data) ?? null;
}

/**
 * Pure attach-function — resolved sobald die Verbindung endet (detach,
 * remote close, oder error). Macht KEIN process.exit, damit die Shell
 * nach Detach weiterlaufen kann. CLI-Caller können den Result auswerten.
 */
export function attachToSession(sid: string, token: string): Promise<AttachResult> {
  return new Promise<AttachResult>((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      resolve({ kind: "error", message: "Terminal-Attach braucht ein TTY." });
      return;
    }

    const url = wsUrlFor(sid);
    const ws = new WebSocket(url, ["techlogia.lab.v1", token], {
      perMessageDeflate: false,
    });

    let detachIdx = 0;
    let resolved = false;
    const finalize = (result: AttachResult): void => {
      if (resolved) return;
      resolved = true;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.removeListener("data", onStdinData);
      stdout.removeListener("resize", sendResize);
      stdin.pause();
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, "client_detach");
      resolve(result);
    };

    const sendResize = (): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: stdout.columns ?? 80,
          rows: stdout.rows ?? 24,
        }),
      );
    };

    const onStdinData = (chunk: Buffer): void => {
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i];
        if (b === DETACH_SEQUENCE[detachIdx]) {
          detachIdx++;
          if (detachIdx === DETACH_SEQUENCE.length) {
            finalize({ kind: "detach" });
            return;
          }
        } else {
          detachIdx = 0;
        }
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    };

    ws.on("open", () => {
      stdin.setRawMode(true);
      stdin.resume();
      sendResize();
      stdin.on("data", onStdinData);
      stdout.on("resize", sendResize);
    });

    ws.on("message", (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("binary");
      if (text.startsWith("{")) {
        try {
          const obj = JSON.parse(text) as { type?: string };
          if (obj.type === "reconnect_token" || obj.type === "heartbeat") return;
        } catch {
          // Kein JSON — als Terminal-Output behandeln (siehe unten).
        }
      }
      stdout.write(data);
    });

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      const reason = reasonBuf.toString();
      if (code === 4401 || code === 4403) finalize({ kind: "auth_failed" });
      else if (code === 4404) finalize({ kind: "not_found" });
      else if (code === 4409) finalize({ kind: "not_ready" });
      else finalize({ kind: "remote_close", code, reason });
    });

    ws.on("error", (err: Error) => {
      finalize({ kind: "error", message: err.message });
    });

    ws.on("unexpected-response", (_req, res) => {
      finalize({
        kind: "error",
        message: `WS-Upgrade abgelehnt: HTTP ${res.statusCode}. Login prüfen.`,
      });
    });
  });
}

export function renderAttachResult(result: AttachResult): void {
  switch (result.kind) {
    case "detach":
      console.log("");
      ui.success("Vom Terminal getrennt. VM läuft weiter.");
      console.log("");
      console.log(ui.dim("  Nächste Schritte:"));
      console.log(ui.dim("    ") + ui.cyan("techlogia lab tasks") + ui.dim("           Aufgaben der aktuellen Lesson anzeigen"));
      console.log(ui.dim("    ") + ui.cyan("techlogia lab validate <slug>") + ui.dim(" Aufgabe vom Backend prüfen lassen"));
      console.log(ui.dim("    ") + ui.cyan("techlogia lab attach") + ui.dim("          erneut ins Terminal"));
      console.log(ui.dim("    ") + ui.cyan("techlogia lab end") + ui.dim("             Session beenden + VM löschen"));
      console.log("");
      break;
    case "remote_close":
      if (result.code === 1000 || result.code === 1001) {
        console.log("");
        ui.dim("Terminal geschlossen.");
      } else {
        console.log("");
        ui.error(`Verbindung verloren (Code ${result.code}): ${result.reason}`);
      }
      break;
    case "auth_failed":
      console.log("");
      ui.error("Auth fehlgeschlagen — bitte neu einloggen.");
      break;
    case "not_ready":
      console.log("");
      ui.warn("Session noch nicht READY — kurz warten und nochmal versuchen.");
      break;
    case "not_found":
      console.log("");
      ui.error("Session unbekannt — bereits beendet?");
      break;
    case "error":
      console.log("");
      ui.error(result.message);
      break;
  }
}

export const attachCommand = new Command("attach")
  .description("Terminal in die laufende Lab-VM öffnen (Strg+P Strg+Q zum Detach)")
  .argument("[session_id]", "Session-UUID (default: aktive Session)")
  .action(async (sessionArg: string | undefined) => {
    try {
      const sid = await resolveSession(sessionArg);
      if (!sid) {
        ui.error("Keine aktive Session.");
        ui.info("Erst starten: " + ui.cyan("techlogia lab start <modul>"));
        return;
      }
      const token = await getAccessToken();
      if (!token) {
        ui.error("Nicht angemeldet.");
        return;
      }
      console.log("");
      console.log(ui.dim("  ━━━ ") + ui.bold("Lab-Terminal") + ui.dim(" ━━━"));
      console.log(ui.dim("  Detach: ") + ui.bold("Strg+P") + ui.dim(" gefolgt von ") + ui.bold("Strg+Q"));
      console.log(ui.dim("  Die VM läuft weiter — du kannst danach Aufgaben validieren oder"));
      console.log(ui.dim("  via ") + ui.cyan("techlogia lab attach") + ui.dim(" wieder reinspringen."));
      console.log("");
      ui.info(`Verbinde mit ${ui.cyan(sid)}...`);
      const result = await attachToSession(sid, token);
      renderAttachResult(result);
    } catch (err) {
      printError(err);
    }
  });
