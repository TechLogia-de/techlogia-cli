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
//   - Detach via Strg+P Strg+Q (analog docker attach) — VM laeuft weiter,
//     Sessions koennen so vom Browser uebernommen werden.
//
// WICHTIG: VM laeuft weiter wenn Detach. Nur `lab stop` zerstoert die VM.

const DETACH_SEQUENCE = [0x10, 0x11]; // Ctrl-P, Ctrl-Q

function wsUrlFor(sessionUuid: string): string {
  const base = getApiBaseUrl();
  // axios baseURL ist https://...; WS-URL nimmt wss://
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/ws/terminal/${sessionUuid}`;
}

async function resolveSession(targetId?: string): Promise<string | null> {
  if (targetId) return targetId;
  // Aktive Session via /active; analog `lab stop --last`.
  const resp = await api.get<LabSession | null>("/api/lab/sessions/active");
  if (!resp.data) return null;
  return sessionId(resp.data) ?? null;
}

export const attachCommand = new Command("attach")
  .description("Terminal in die laufende Lab-VM oeffnen (Strg+P Strg+Q zum Detach)")
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

      if (!process.stdin.isTTY) {
        ui.error("Terminal-Attach braucht ein TTY (interaktive Shell).");
        return;
      }

      const url = wsUrlFor(sid);
      ui.info(`Verbinde mit ${ui.cyan(sid)}...`);
      ui.dim("Detach: Strg+P Strg+Q (VM laeuft weiter). Beenden: techlogia lab stop --last");

      // Subprotocol-Auth: erster Wert ist der Protocol-Name, zweiter der JWT
      // (D-14, RFC 6455). Wenn das Subprotocol nicht akzeptiert wird, wirft
      // das ws-Package einen UPGRADE-Fehler im 'unexpected-response'-Handler.
      const ws = new WebSocket(url, ["techlogia.lab.v1", token], {
        perMessageDeflate: false,
      });

      let detachIdx = 0;
      const stdin = process.stdin;
      const stdout = process.stdout;

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

      const cleanup = (msg: string, exitCode = 0): void => {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.removeAllListeners("data");
        stdin.pause();
        stdout.removeListener("resize", sendResize);
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "client_detach");
        console.log("\r\n" + msg);
        process.exit(exitCode);
      };

      ws.on("open", () => {
        // Raw-Mode: jede Taste sofort an WS (keine Line-Buffering)
        stdin.setRawMode(true);
        stdin.resume();
        sendResize();

        stdin.on("data", (chunk: Buffer) => {
          // Detach-Sequenz erkennen: zwei Bytes in Folge.
          // chunk kann mehrere Bytes haben (Paste). Wir scannen byteweise.
          for (let i = 0; i < chunk.length; i++) {
            const b = chunk[i];
            if (b === DETACH_SEQUENCE[detachIdx]) {
              detachIdx++;
              if (detachIdx === DETACH_SEQUENCE.length) {
                cleanup(ui.green("✓ Vom Terminal getrennt. VM laeuft weiter."), 0);
                return;
              }
            } else {
              detachIdx = 0;
            }
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
          }
        });

        stdout.on("resize", sendResize);
      });

      ws.on("message", (data: Buffer | string) => {
        // Backend sendet entweder raw bytes (Terminal-Output) oder JSON-Frames
        // (reconnect_token-Refresh, heartbeat). Wir versuchen JSON; wenn das
        // failed: behandeln wir es als Terminal-Output und schreiben es raw.
        const text = typeof data === "string" ? data : data.toString("binary");
        if (text.startsWith("{")) {
          try {
            const obj = JSON.parse(text) as { type?: string };
            if (obj.type === "reconnect_token" || obj.type === "heartbeat") {
              // Stille verarbeiten — Token-Refresh + Heartbeat sind interne
              // WS-Protocol-Frames, nicht Terminal-Output.
              return;
            }
          } catch {
            // Kein JSON — als Terminal-Output behandeln (siehe unten).
          }
        }
        // Raw schreiben — ANSI-Escapes muessen unveraendert durchgereicht werden
        // damit ncurses, vim, htop etc. korrekt rendern.
        if (typeof data === "string") {
          stdout.write(data);
        } else {
          stdout.write(data);
        }
      });

      ws.on("close", (code: number, reasonBuf: Buffer) => {
        const reason = reasonBuf.toString();
        if (code === 1000 || code === 1001) {
          cleanup(ui.dim("Terminal geschlossen."), 0);
        } else if (code === 4401 || code === 4403) {
          cleanup(ui.red("Auth fehlgeschlagen — neu einloggen via `techlogia login`."), 1);
        } else if (code === 4404) {
          cleanup(ui.red("Session unbekannt — bereits beendet?"), 1);
        } else if (code === 4409) {
          cleanup(
            ui.yellow("Session noch nicht READY — kurz warten und nochmal versuchen."),
            1,
          );
        } else {
          cleanup(ui.red(`Verbindung verloren (Code ${code}): ${reason}`), 1);
        }
      });

      ws.on("error", (err: Error) => {
        cleanup(ui.red(`WS-Fehler: ${err.message}`), 1);
      });

      ws.on("unexpected-response", (_req, res) => {
        cleanup(
          ui.red(`WS-Upgrade abgelehnt: HTTP ${res.statusCode}. Login pruefen.`),
          1,
        );
      });

      // Sauberer Shutdown bei Strg+C — VM laeuft weiter, NICHT terminated.
      process.on("SIGINT", () => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "sigint");
      });
    } catch (err) {
      printError(err);
    }
  });
