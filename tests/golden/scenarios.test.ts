import { describe, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ImessageMode, type Provider, scaffold } from "~/scaffold.ts";
import { assertMatchesGolden } from "../helpers/golden.ts";
import { silentLogger } from "../helpers/logger.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Scenario {
  imessageMode?: ImessageMode;
  name: string;
  providers: Provider[];
}

const SCENARIOS: Scenario[] = [
  { name: "terminal-only", providers: ["terminal"] },
  // Added in Task 4:
  // { name: "imessage-cloud", providers: ["imessage"], imessageMode: "cloud" },
  // { name: "imessage-local", providers: ["imessage"], imessageMode: "local" },
  // Added in Task 5:
  // { name: "whatsapp-only", providers: ["whatsapp"] },
  // { name: "all-production", providers: ["imessage", "whatsapp"], imessageMode: "cloud" },
];

describe("golden scenarios", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, async () => {
      await withTempDir(async (dir) => {
        const target = tempTarget(dir, scenario.name);
        await scaffold({
          targetDir: target,
          name: scenario.name,
          providers: scenario.providers,
          imessageMode: scenario.imessageMode,
          install: false,
          git: false,
          logger: silentLogger(),
          resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        });
        await assertMatchesGolden(target, join(HERE, scenario.name));
      });
    });
  }
});
