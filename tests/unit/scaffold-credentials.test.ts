import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffold } from "~/scaffold.ts";
import { silentLogger } from "../helpers/logger.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

describe("scaffold — credentials", () => {
  test("fills PROJECT_ID/PROJECT_SECRET in .env when credentials are provided", async () => {
    await withTempDir(async (dir) => {
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["imessage"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        skills: false,
        logger: silentLogger(),
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
        credentials: {
          projectId: "proj_abc",
          projectSecret: "spk_live_abc",
        },
      });

      const env = await readFile(join(result.targetDir, ".env"), "utf8");
      expect(env).toContain("PROJECT_ID=proj_abc");
      expect(env).toContain("PROJECT_SECRET=spk_live_abc");
    });
  });

  test("leaves PROJECT_ID/PROJECT_SECRET blank when no credentials", async () => {
    await withTempDir(async (dir) => {
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["imessage"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        skills: false,
        logger: silentLogger(),
        resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
      });

      const env = await readFile(join(result.targetDir, ".env"), "utf8");
      expect(env).toContain("PROJECT_ID=\n");
      expect(env).toContain("PROJECT_SECRET=");
      expect(env).not.toContain("spk_live");
    });
  });
});
