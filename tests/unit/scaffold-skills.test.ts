import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { scaffold } from "~/scaffold.ts";
import { silentLogger } from "../helpers/logger.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

describe("scaffold — skills install", () => {
  test("calls the runner with the canonical args when skills !== false", async () => {
    await withTempDir(async (dir) => {
      const calls: Array<{ cwd: string; args: readonly string[] }> = [];
      const logger = silentLogger();
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        skillsRunner: async (args, cwd) => {
          calls.push({ cwd, args });
          return 0;
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual([
        "-y",
        "skills",
        "add",
        "photon-hq/skills",
        "--skill",
        "spectrum",
        "-a",
        "universal",
        "-y",
      ]);
      expect(calls[0]?.cwd).toBe(result.targetDir);
      expect(result.steps.skillsInstalled).toBe(true);
    });
  });

  test("pre-creates .claude/ before invoking the runner", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      let claudeExisted = false;
      await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        skillsRunner: async (_args, cwd) => {
          try {
            const s = await stat(join(cwd, ".claude"));
            claudeExisted = s.isDirectory();
          } catch {
            claudeExisted = false;
          }
          return 0;
        },
      });
      expect(claudeExisted).toBe(true);
    });
  });

  test("skills: false skips the spawn and skillsInstalled is false", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      let called = false;
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        skills: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        skillsRunner: async () => {
          called = true;
          return 0;
        },
      });
      expect(called).toBe(false);
      expect(result.steps.skillsInstalled).toBe(false);
    });
  });

  test("non-zero exit warns and returns skillsInstalled=false but does not throw", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        skillsRunner: async () => 1,
      });
      expect(result.steps.skillsInstalled).toBe(false);
      expect(
        logger.warnings.some((w) => w.toLowerCase().includes("skill")),
      ).toBe(true);
    });
  });

  test("runner throwing warns and returns skillsInstalled=false but does not throw", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        skillsRunner: async () => {
          throw new Error("npx unavailable");
        },
      });
      expect(result.steps.skillsInstalled).toBe(false);
      expect(logger.warnings.some((w) => w.includes("npx unavailable"))).toBe(
        true,
      );
    });
  });
});
