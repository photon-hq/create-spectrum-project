import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Provider, scaffold } from "~/scaffold.ts";
import { assertMatchesGolden } from "../helpers/golden.ts";
import { silentLogger } from "../helpers/logger.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Scenario {
  name: string;
  providers: Provider[];
  expectedEnv: string | null;
}

const SCENARIOS: Scenario[] = [
  { name: "terminal-only", providers: ["terminal"], expectedEnv: null },
  {
    name: "imessage",
    providers: ["imessage"],
    expectedEnv: "PROJECT_ID=\nPROJECT_SECRET=\n",
  },
  {
    name: "whatsapp-only",
    providers: ["whatsapp-business"],
    expectedEnv: "PROJECT_ID=\nPROJECT_SECRET=\n",
  },
  {
    name: "telegram-only",
    providers: ["telegram"],
    expectedEnv: "PROJECT_ID=\nPROJECT_SECRET=\nTELEGRAM_BOT_TOKEN=\n",
  },
  {
    name: "all-platforms",
    providers: ["imessage", "telegram", "whatsapp-business"],
    expectedEnv: "PROJECT_ID=\nPROJECT_SECRET=\nTELEGRAM_BOT_TOKEN=\n",
  },
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
          manifest: FIXTURE_MANIFEST,
          install: false,
          git: false,
          skills: false,
          logger: silentLogger(),
          resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        });
        await assertMatchesGolden(target, join(HERE, scenario.name));

        const envPath = join(target, ".env");
        if (scenario.expectedEnv === null) {
          await expect(stat(envPath)).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          expect(await readFile(envPath, "utf8")).toBe(scenario.expectedEnv);
        }
      });
    });
  }
});
