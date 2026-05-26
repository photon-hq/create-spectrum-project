import { expect } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Snapshot every file under actualDir and compare against the committed
 * goldenDir tree. Setting UPDATE_GOLDEN=1 rewrites the golden dir from
 * actual — review the resulting diff in your PR.
 */
export async function assertMatchesGolden(
  actualDir: string,
  goldenDir: string
): Promise<void> {
  const actual = await snapshot(actualDir);

  if (UPDATE) {
    await rewriteGolden(goldenDir, actual);
    return;
  }

  let expected: Record<string, string>;
  try {
    expected = await snapshot(goldenDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Golden dir missing: ${goldenDir}. Run \`UPDATE_GOLDEN=1 bun test\` to create it.`
      );
    }
    throw err;
  }

  const allKeys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of [...allKeys].sort()) {
    expect(actual[key], `mismatch in ${key}`).toBe(
      expected[key] ?? "<missing in golden>"
    );
  }
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    // .env is gitignored in the published template, so it can't live in the
    // committed golden tree. Scenarios assert its content inline instead.
    if (entry.name === ".env") {
      continue;
    }
    const abs = join(entry.parentPath, entry.name);
    const rel = relative(dir, abs);
    out[rel] = await readFile(abs, "utf8");
  }
  return out;
}

async function rewriteGolden(
  goldenDir: string,
  snap: Record<string, string>
): Promise<void> {
  await rm(goldenDir, { recursive: true, force: true });
  await mkdir(goldenDir, { recursive: true });
  for (const [rel, content] of Object.entries(snap)) {
    const abs = join(goldenDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}
