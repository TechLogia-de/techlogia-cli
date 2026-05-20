import { defineConfig } from "tsup";

// tsup buendelt die TS-Quellen in ein single-file CJS-Bundle.
// Single-file ist fuer eine global installierte CLI ideal: kein Lazy-Resolve
// von relativen Modulen ueber den globalen npm-Pfad, ein einziger Startpunkt.
// banner.js setzt den shebang in Zeile 1, damit "techlogia" als Binary
// direkt durch node ausfuehrbar ist.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
  minify: false,
  splitting: false,
  sourcemap: false,
  // keytar ist optional-deps + native — nie buendeln, sonst crasht der Build.
  // chalk@4 ist CJS und vertraegt Bundling; chalk@5 waere ESM-only.
  external: ["keytar"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
