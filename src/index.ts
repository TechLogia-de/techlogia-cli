// Entry-Point der CLI — shebang wird von tsup als banner injiziert,
// damit der gebaute dist/index.js direkt durch node ausfuehrbar ist
// (npm setzt nach install -g das +x-Bit).
import { runCli } from "./cli";
import { printError } from "./ui";

runCli().catch((err: unknown) => {
  printError(err);
  process.exit(1);
});
