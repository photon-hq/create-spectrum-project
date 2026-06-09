import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageManager } from "~/pm.ts";
import { scaffold } from "~/scaffold.ts";
import { silentLogger } from "../helpers/logger.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";
import { tempTarget, withTempDir } from "../helpers/tempdir.ts";

async function scaffoldWithPm(targetDir: string, pm: PackageManager) {
  await scaffold({
    targetDir,
    name: "pm-test",
    providers: ["terminal"],
    manifest: FIXTURE_MANIFEST,
    packageManager: pm,
    install: false,
    git: false,
    skills: false,
    logger: silentLogger(),
    resolveSpectrumTsVersion: () => Promise.resolve("^1.2.3"),
  });
}

describe("scaffold — package manager runtime wiring", () => {
  test("npm gets tsx scripts and @types/node", async () => {
    await withTempDir(async (dir) => {
      const target = tempTarget(dir, "npm-app");
      await scaffoldWithPm(target, "npm");
      const pkg = JSON.parse(
        await readFile(join(target, "package.json"), "utf8")
      ) as {
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(pkg.scripts.start).toBe("tsx src/index.ts");
      expect(pkg.scripts.dev).toBe("tsx watch src/index.ts");
      expect(pkg.devDependencies).toHaveProperty("tsx");
      expect(pkg.devDependencies).toHaveProperty("@types/node");
      expect(pkg.devDependencies).not.toHaveProperty("@types/bun");

      const tsconfig = JSON.parse(
        await readFile(join(target, "tsconfig.json"), "utf8")
      ) as { compilerOptions: { types: string[] } };
      expect(tsconfig.compilerOptions.types).toEqual(["node"]);
    });
  });

  test("bun keeps bun scripts and @types/bun", async () => {
    await withTempDir(async (dir) => {
      const target = tempTarget(dir, "bun-app");
      await scaffoldWithPm(target, "bun");
      const pkg = JSON.parse(
        await readFile(join(target, "package.json"), "utf8")
      ) as {
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(pkg.scripts.start).toBe("bun src/index.ts");
      expect(pkg.scripts.dev).toBe("bun --watch src/index.ts");
      expect(pkg.devDependencies).toHaveProperty("@types/bun");
      expect(pkg.devDependencies).not.toHaveProperty("tsx");
    });
  });

  test("pnpm and yarn also use tsx", async () => {
    for (const pm of ["pnpm", "yarn"] as const) {
      await withTempDir(async (dir) => {
        const target = tempTarget(dir, `${pm}-app`);
        await scaffoldWithPm(target, pm);
        const pkg = JSON.parse(
          await readFile(join(target, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts.start).toBe("tsx src/index.ts");
        expect(pkg.scripts.dev).toBe("tsx watch src/index.ts");
      });
    }
  });
});
