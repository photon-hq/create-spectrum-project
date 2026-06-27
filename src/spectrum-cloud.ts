// Provisions a Spectrum Cloud project via the `photon` CLI (the binary that
// talks to Spectrum Cloud) and returns its credentials for the scaffold's .env.
import { spawn } from "node:child_process";

export interface SpectrumCredentials {
  projectId: string;
  projectSecret: string;
}

export interface CloudLogger {
  step(msg: string): void;
  warn(msg: string): void;
}

/** Runs a `photon` CLI subcommand; injectable so tests can stub it. */
export type CliRunner = (
  args: readonly string[],
  opts: { capture: boolean }
) => Promise<{ code: number; stdout: string }>;

export interface ProvisionDeps {
  logger?: CloudLogger;
  runner?: CliRunner;
}

const NOOP_LOGGER: CloudLogger = {
  step: (msg) => process.stderr.write(`${msg}\n`),
  warn: (msg) => process.stderr.write(`warn: ${msg}\n`),
};

/**
 * Resolve selected provider keys to the deduped, order-preserving list of
 * Spectrum Cloud platform names accepted by `projects create --platforms`.
 *
 * iMessage is always included: it's mandatory for any Spectrum Cloud project,
 * so every cloud provision enables it regardless of which platforms the user
 * scaffolded locally.
 */
export function cloudPlatformsFor(providers: readonly string[]): string[] {
  const platforms: string[] = ["imessage"];
  for (const provider of providers) {
    const platformNormalized = provider.replace(/-/g, "_");
    if (!platforms.includes(platformNormalized)) {
      platforms.push(platformNormalized);
    }
  }
  return platforms;
}

function spawnPhoton(
  cmd: string,
  args: readonly string[],
  capture: boolean
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(cmd, args as string[], {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    if (capture) {
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      // Drain stderr so the pipe can't fill and stall the child.
      proc.stderr?.resume();
    }
    proc.once("error", rejectRun);
    proc.once("close", (code) => resolveRun({ code: code ?? -1, stdout }));
  });
}

/**
 * Prefer a `photon` on PATH; otherwise run the published CLI through the
 * package runner (bun vs node picked the same way as scaffold's skills
 * installer).
 */
async function resolveInvocation(): Promise<[string, ...string[]]> {
  try {
    const { code } = await spawnPhoton("photon", ["--version"], true);
    if (code === 0) {
      return ["photon"];
    }
  } catch {
    // not on PATH — fall through to the package runner
  }
  const runner = typeof process.versions.bun === "string" ? "bunx" : "npx";
  return [runner, "-y", "@photon-ai/cli"];
}

function defaultRunner(): CliRunner {
  let invocation: [string, ...string[]] | null = null;
  return async (args, { capture }) => {
    if (!invocation) {
      invocation = await resolveInvocation();
    }
    const [cmd, ...prefix] = invocation;
    return spawnPhoton(cmd, [...prefix, ...args], capture);
  };
}

async function isAuthed(run: CliRunner): Promise<boolean> {
  // `whoami` exits 0 when authenticated for the active backend, non-zero
  // otherwise. (It has no --json flag — the exit code is the signal.)
  const { code } = await run(["whoami"], { capture: true });
  return code === 0;
}

function parseField(
  result: { code: number; stdout: string },
  field: string
): string | null {
  if (result.code !== 0) {
    return null;
  }
  try {
    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    const value = data[field];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Set up a Spectrum Cloud project and return its credentials, ready to be
 * written into the scaffold's `.env`. Authenticates inline (running `photon
 * login` if needed), then mints the project secret.
 *
 * When `opts.projectId` is supplied, the create step is skipped entirely: the
 * existing project is used as-is and `opts.platforms`/`opts.name` are ignored.
 * Otherwise a fresh project is created enabling `opts.platforms` (pass an empty
 * list for a project with no managed platform — e.g. a Slack/Telegram-only
 * scaffold that just needs the secret).
 *
 * `opts.rotateSecret` only applies to an existing `opts.projectId`. When it's
 * `false`, the secret is left untouched (rotating it would invalidate the one
 * already in use): PROJECT_ID is still pinned and the returned `projectSecret`
 * is empty so the user fills it in from the dashboard. A freshly created
 * project always mints, regardless of this flag.
 */
export async function provisionSpectrumProject(
  opts: {
    name: string;
    platforms: readonly string[];
    projectId?: string;
    rotateSecret?: boolean;
  },
  deps: ProvisionDeps = {}
): Promise<SpectrumCredentials | null> {
  const logger = deps.logger ?? NOOP_LOGGER;
  const run = deps.runner ?? defaultRunner();
  const bail = (msg: string): null => {
    logger.warn(`${msg} Fill in .env manually.`);
    return null;
  };

  try {
    if (!(await isAuthed(run))) {
      logger.step("Logging in to Spectrum Cloud…");
      await run(["login"], { capture: false });
      if (!(await isAuthed(run))) {
        return bail("Spectrum Cloud login did not complete; skipping setup.");
      }
    }

    let projectId: string;
    if (opts.projectId) {
      logger.step("Using your existing Spectrum Cloud project…");
      projectId = opts.projectId;
    } else {
      logger.step("Creating your Spectrum Cloud project…");
      const createArgs = ["projects", "create", "--name", opts.name];
      if (opts.platforms.length > 0) {
        createArgs.push("--platforms", opts.platforms.join(","));
      }
      createArgs.push("--json");
      const created = await run(createArgs, { capture: true });
      const createdId = parseField(created, "id");
      if (!createdId) {
        return bail(
          "Could not create the Spectrum Cloud project; skipping setup."
        );
      }
      projectId = createdId;
    }

    // Existing project + the user declined rotation: keep their secret valid
    // and hand back a blank one to fill in manually.
    if (opts.projectId && opts.rotateSecret === false) {
      logger.step(
        "Keeping the existing secret — fill PROJECT_SECRET into .env yourself."
      );
      return { projectId, projectSecret: "" };
    }

    logger.step("Generating project secret…");
    const rotated = await run(
      ["projects", "regenerate-secret", "-y", "--project", projectId, "--json"],
      { capture: true }
    );
    const projectSecret = parseField(rotated, "projectSecret");
    if (!projectSecret) {
      return bail(
        opts.projectId
          ? `Could not mint a secret for project ${projectId}; check the id and your access with \`photon whoami\`.`
          : "Created the project but could not mint its secret;"
      );
    }

    return { projectId, projectSecret };
  } catch (err) {
    return bail(
      `Spectrum Cloud setup failed (${err instanceof Error ? err.message : String(err)}).`
    );
  }
}
