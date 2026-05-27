import { describe, expect, test } from "bun:test";
import { FALLBACK_SPECTRUM_TS_VERSION, scaffold } from "~/scaffold.ts";
import { silentLogger } from "../helpers/logger.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

describe("scaffold — version resolution", () => {
  test("uses injected resolver result", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        skills: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.resolve("^9.9.9"),
      });
      expect(result.spectrumTsVersion).toBe("^9.9.9");
      const pkgRaw = await Bun.file(`${result.targetDir}/package.json`).text();
      const pkg = JSON.parse(pkgRaw) as {
        dependencies: Record<string, string>;
      };
      expect(pkg.dependencies["spectrum-ts"]).toBe("^9.9.9");
    });
  });

  test("falls back and warns when resolver throws", async () => {
    await withTempDir(async (dir) => {
      const logger = silentLogger();
      const result = await scaffold({
        targetDir: tempTarget(dir),
        providers: ["terminal"],
        manifest: FIXTURE_MANIFEST,
        install: false,
        git: false,
        skills: false,
        logger,
        resolveSpectrumTsVersion: () => Promise.reject(new Error("offline")),
      });
      expect(result.spectrumTsVersion).toBe(FALLBACK_SPECTRUM_TS_VERSION);
      expect(logger.warnings.some((w) => w.includes("offline"))).toBe(true);
    });
  });
});
