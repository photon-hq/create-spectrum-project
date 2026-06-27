#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { isPm, type PackageManager } from "./pm.ts";
import { type PartialOptions, promptForOptions } from "./prompts.ts";
import {
  fetchManifest,
  InstallError,
  type Manifest,
  type Provider,
  scaffold,
  TargetExistsError,
  TERMINAL_KEY,
  VersionResolutionError,
} from "./scaffold.ts";
import {
  cloudPlatformsFor,
  provisionSpectrumProject,
} from "./spectrum-cloud.ts";

const SYM = {
  ok: pc.green("✓"),
  err: pc.red("✗"),
  arrow: pc.dim("→"),
  dot: pc.dim("·"),
};

/**
 * Provider keys published in spectrum-ts's manifest but intentionally hidden
 * from the CLI surface — usually because they're not yet ready for public
 * scaffolding (in-flight integrations, internal-only, etc.).
 *
 * Filtered out before prompts render and rejected by `--providers` flag
 * validation. The underlying library API still supports them, so internal
 * tooling (e.g. `photon spectrum init`) can opt in.
 */
const HIDDEN_PROVIDERS = new Set<string>(["slack"]);

function visibleManifest(manifest: Manifest): Manifest {
  return manifest.filter((m) => !HIDDEN_PROVIDERS.has(m.key));
}

// Parsed argv shape, shared by `main()` and `parseCliArgs` (exported for tests).
// `platforms` is an alias for `providers`: the interactive prompts and Spectrum
// Cloud both speak in "platforms", so that's the word users reach for on the
// command line. Accepting only `--providers` made `--platforms imessage` fail
// with "Unknown option", which read as "-y is broken when other flags are set".
const CLI_OPTIONS = {
  providers: { type: "string" },
  platforms: { type: "string" },
  projectId: { type: "string" },
  pm: { type: "string" },
  install: { type: "boolean", default: true },
  "no-install": { type: "boolean" },
  git: { type: "boolean", default: true },
  "no-git": { type: "boolean" },
  "no-skills": { type: "boolean" },
  "no-cloud": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const;

export function parseCliArgs(args: string[]) {
  return parseArgs({
    args,
    options: CLI_OPTIONS,
    allowPositionals: true,
    strict: true,
  });
}

async function main(): Promise<number> {
  const { values, positionals } = parseCliArgs(process.argv.slice(2));

  const version = await readOwnVersion();

  if (values.help) {
    printHelp();
    return 0;
  }
  if (values.version) {
    process.stdout.write(`create-spectrum-project ${version}\n`);
    return 0;
  }

  process.stdout.write(
    `\n${pc.bold("create-spectrum-project")} ${pc.dim(`v${version}`)}\n\n`
  );

  // Fetch the live provider list before prompts or flag validation can run,
  // so both consult the same source of truth. Fail-soft to the bundled
  // fallback if unpkg is unreachable.
  const fullManifest = await fetchManifest({
    step: () => {
      // no spinner yet
    },
    warn: (msg) => {
      process.stderr.write(`${pc.yellow("!")} ${msg}\n`);
    },
    stream: () => {
      // no-op
    },
  });
  const manifest = visibleManifest(fullManifest);

  const partial = collectFlagOptions(values, positionals, manifest);

  const opts = values.yes
    ? fillDefaults(partial, manifest)
    : await promptForOptions(partial, manifest);

  // One blank line of breathing room before the spinner — only after prompts,
  // since the -y path already has its own blank between the banner and the spinner.
  if (!values.yes) {
    process.stdout.write("\n");
  }

  // Set up Spectrum Cloud before the spinner starts
  const credentials = opts.provisionCloud
    ? ((await provisionSpectrumProject(
        {
          name: basename(resolve(opts.targetDir)),
          platforms: cloudPlatformsFor(opts.providers),
          projectId: opts.projectId,
          rotateSecret: opts.rotateSecret,
        },
        {
          logger: {
            step: (msg) => process.stdout.write(`${SYM.arrow} ${msg}\n`),
            warn: (msg) => process.stderr.write(`${pc.yellow("!")} ${msg}\n`),
          },
        }
      )) ?? undefined)
    : undefined;

  const start = Date.now();
  const spin = startSpinner();
  let result: Awaited<ReturnType<typeof scaffold>>;
  try {
    result = await scaffold({
      ...opts,
      credentials,
      manifest: fullManifest,
      logger: {
        step: (msg) => spin.text(msg),
        warn: (msg) => {
          spin.suspend();
          process.stderr.write(`${pc.yellow("!")} ${msg}\n`);
          spin.resume();
        },
        stream: (chunk) => {
          if (values.verbose) {
            process.stderr.write(chunk);
          }
        },
      },
    });
  } catch (err) {
    // Critical: stop the spinner so its setInterval can't keep the event
    // loop alive after we set process.exitCode in the top-level catch.
    spin.stop();
    throw err;
  }
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  spin.stop(
    `${SYM.ok} Created ${pc.cyan(basename(result.targetDir))} ${SYM.dot} ${pc.bold(`spectrum-ts ${result.spectrumTsVersion}`)} ${pc.dim(`(${seconds}s)`)}`
  );

  // A blank secret (user declined rotation) still needs filling in, so treat
  // credentials as "written" only when the secret is actually present.
  const secretWritten =
    credentials !== undefined && credentials.projectSecret.length > 0;
  printNextSteps(result, opts, secretWritten);
  process.stdout.write(
    `\n${SYM.arrow} ${pc.dim("Docs:")} ${pc.cyan("https://photon.codes/docs/spectrum-ts")}\n\n`
  );
  return 0;
}

export function collectFlagOptions(
  values: Record<string, unknown>,
  positionals: string[],
  manifest: Manifest
): PartialOptions {
  const partial: PartialOptions = {};
  if (positionals[0]) {
    partial.targetDir = positionals[0];
  }
  // `--platforms` is an alias for `--providers`; reject passing both so an
  // ambiguous `--providers a --platforms b` doesn't silently pick one.
  if (
    typeof values.providers === "string" &&
    typeof values.platforms === "string"
  ) {
    fail("Use either --platforms or --providers, not both.");
  }
  const platformsRaw =
    typeof values.platforms === "string" ? values.platforms : values.providers;
  if (typeof platformsRaw === "string") {
    partial.providers = parseProviders(platformsRaw, manifest);
  }
  if (typeof values.projectId === "string") {
    const id = values.projectId.trim();
    if (!id) {
      fail("--projectId must not be empty.");
    }
    if (values["no-cloud"]) {
      fail(
        "--projectId can't be combined with --no-cloud — the project id is what sets up Spectrum Cloud."
      );
    }
    partial.projectId = id;
  }
  if (typeof values.pm === "string") {
    if (!isPm(values.pm)) {
      fail("--pm must be one of bun, npm, pnpm, yarn");
    }
    partial.packageManager = values.pm as PackageManager;
  }
  if (values["no-install"]) {
    partial.install = false;
  }
  if (values["no-git"]) {
    partial.git = false;
  }
  if (values["no-skills"]) {
    partial.skills = false;
  }
  if (values["no-cloud"]) {
    partial.cloud = false;
  }
  return partial;
}

function parseProviders(raw: string, manifest: Manifest): Provider[] {
  const validKeys = manifest.map((m) => m.key);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!validKeys.includes(p)) {
      fail(`Unknown provider: ${p}. Available: ${validKeys.join(", ")}`);
    }
  }
  if (parts.length === 0) {
    fail("--platforms/--providers must list at least one provider");
  }
  if (parts.includes(TERMINAL_KEY) && parts.length > 1) {
    fail(
      `${TERMINAL_KEY} is a dev-only TUI and can't be mixed with platform providers. Pick ${TERMINAL_KEY} on its own, or pick one or more of: ${validKeys.filter((k) => k !== TERMINAL_KEY).join(", ")}.`
    );
  }
  return parts;
}

function fillDefaults(partial: PartialOptions, manifest: Manifest) {
  // Default to the first platform provider (alphabetical by key in the
  // manifest). Falls back to terminal only if no platform providers exist.
  const fallbackProvider =
    manifest.find((m) => m.key !== TERMINAL_KEY)?.key ?? manifest[0]?.key;
  if (!fallbackProvider) {
    fail("Manifest is empty — no providers to scaffold.");
  }
  const providers = partial.providers ?? [fallbackProvider];
  return {
    targetDir: partial.targetDir ?? "my-spectrum-app",
    providers,
    packageManager: partial.packageManager,
    install: partial.install ?? true,
    git: partial.git ?? true,
    skills: partial.skills ?? true,
    projectId: partial.projectId,
    // Cloud setup normally needs an interactive login, so the unattended -y
    // path opts out — unless the user pinned a project with --projectId, in
    // which case provisioning (mint secret → .env) is exactly what they asked
    // for. It still fails soft to a manual .env if auth can't complete.
    provisionCloud: partial.projectId !== undefined,
    // -y is "do the whole thing unattended": when a project is pinned, that
    // includes rotating its secret (the interactive caution prompt is skipped).
    rotateSecret: partial.projectId === undefined ? undefined : true,
  } satisfies PartialOptions & {
    targetDir: string;
    providers: Provider[];
    provisionCloud: boolean;
    rotateSecret: boolean | undefined;
  };
}

function printNextSteps(
  result: {
    needsEnvFile: boolean;
    hasProviderEnvVars: boolean;
    steps: {
      installed: boolean;
      skillsInstalled: boolean;
      gitInitialized: boolean;
    };
    targetDir: string;
  },
  opts: { packageManager?: PackageManager; skills?: boolean },
  credentialsWritten: boolean
): void {
  const pm = opts.packageManager ?? "bun";
  const cwd = basename(result.targetDir);

  type Step = { cmd: string } | { note: string };
  const steps: Step[] = [{ cmd: `cd ${cwd}` }];
  if (!result.steps.installed) {
    steps.push({ cmd: pm === "yarn" ? "yarn" : `${pm} install` });
  }
  // Provisioning only fills PROJECT_ID/PROJECT_SECRET, so provider-specific
  // vars (e.g. TELEGRAM_BOT_TOKEN) stay blank even when credentials were
  // written. Only suppress the reminder when nothing is left to fill in.
  const envFullyProvisioned = credentialsWritten && !result.hasProviderEnvVars;
  if (result.needsEnvFile && !envFullyProvisioned) {
    steps.push({ note: "fill in .env with your credentials" });
  }
  steps.push({ cmd: pm === "npm" ? "npm run start" : `${pm} start` });
  // We tried to install the skill but it failed (warned during scaffold).
  // Surface a remediation hint so it's not buried in spinner output. The
  // runner picker matches `defaultSkillsRunner` so the printed command is
  // the same one the scaffolder itself just ran — important because npx
  // isn't guaranteed on Bun-only setups, and bunx isn't guaranteed on
  // Node-only setups.
  if (opts.skills !== false && !result.steps.skillsInstalled) {
    const runner = typeof process.versions.bun === "string" ? "bunx" : "npx";
    steps.push({
      note: `spectrum skill install failed; retry: ${runner} -y skills add photon-hq/skills --skill spectrum --agent '*' -y`,
    });
  }

  process.stdout.write(`\n${pc.bold("Next steps")}\n`);
  for (const step of steps) {
    const line =
      "cmd" in step
        ? `  ${pc.dim("$")} ${step.cmd}`
        : `  ${pc.dim(`# ${step.note}`)}`;
    process.stdout.write(`${line}\n`);
  }
}

interface Spinner {
  resume: () => void;
  stop: (final?: string) => void;
  suspend: () => void;
  text: (msg: string) => void;
}

function startSpinner(): Spinner {
  // Quiet fallback for non-TTY (CI piping, redirects): no animation, just
  // print the final line on stop.
  if (!process.stderr.isTTY) {
    return {
      text: () => {
        // no-op
      },
      suspend: () => {
        // no-op
      },
      resume: () => {
        // no-op
      },
      stop: (final) => {
        if (final) {
          process.stderr.write(`${final}\n`);
        }
      },
    };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let msg = "Working";
  let paused = false;
  const render = () => {
    if (paused) {
      return;
    }
    process.stderr.write(
      `\r\x1b[K${pc.dim(frames[i++ % frames.length])} ${msg}`
    );
  };
  const interval = setInterval(render, 80);
  render();
  return {
    text: (m) => {
      msg = m;
      render();
    },
    suspend: () => {
      paused = true;
      process.stderr.write("\r\x1b[K");
    },
    resume: () => {
      paused = false;
      render();
    },
    stop: (final) => {
      clearInterval(interval);
      process.stderr.write("\r\x1b[K");
      if (final) {
        process.stderr.write(`${final}\n`);
      }
    },
  };
}

function printHelp(): void {
  const flag = (s: string) => pc.cyan(s);
  const dim = (s: string) => pc.dim(s);
  const pad = (s: string) => s.padEnd(24, " ");
  const rows: [string, string][] = [
    [
      pad(`${flag("--platforms")} <list>`),
      "Comma-separated platform keys (alias: --providers)",
    ],
    [
      pad(`${flag("--projectId")} <id>`),
      "Use an existing Spectrum Cloud project.",
    ],
    [
      pad(`${flag("--pm")} <m>`),
      `bun | npm | pnpm | yarn ${dim("(default: detected)")}`,
    ],
    [pad(flag("--no-install")), "Skip dependency install"],
    [pad(flag("--no-git")), "Skip git init"],
    [pad(flag("--no-skills")), "Skip Spectrum skill install"],
    [pad(flag("--no-cloud")), "Skip Spectrum Cloud project setup"],
    [
      pad(`${flag("-y")}, ${flag("--yes")}`),
      "Use defaults; skip interactive prompts",
    ],
    [pad(flag("--verbose")), "Stream install stdout/stderr"],
    [pad(`${flag("-h")}, ${flag("--help")}`), "Show this help"],
    [pad(flag("--version")), "Show version"],
  ];
  process.stdout.write(
    [
      "",
      `  ${pc.bold("Usage")}`,
      `    ${dim("$")} create-spectrum-project ${dim("[directory] [options]")}`,
      "",
      `  ${pc.bold("Options")}`,
      ...rows.map(([k, v]) => `    ${k}${dim(v)}`),
      "",
    ].join("\n")
  );
}

async function readOwnVersion(): Promise<string> {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function fail(message: string): never {
  process.stderr.write(`${SYM.err} ${message}\n`);
  process.exit(2);
}

function reportError(err: unknown): void {
  if (err instanceof TargetExistsError) {
    process.stderr.write(`\n${SYM.err} ${err.message}\n`);
    process.exitCode = 1;
  } else if (err instanceof InstallError) {
    process.stderr.write(
      `\n${SYM.err} Install failed (exit ${err.exitCode}). cd into the project and run install manually to retry.\n`
    );
    process.exitCode = 1;
  } else if (err instanceof VersionResolutionError) {
    process.stderr.write(`\n${SYM.err} ${err.message}\n`);
    process.exitCode = 1;
  } else if (err instanceof Error) {
    process.stderr.write(`\n${SYM.err} ${err.message}\n`);
    if (process.argv.includes("--verbose") && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stderr.write(`\n${SYM.err} ${String(err)}\n`);
    process.exitCode = 1;
  }
}

// Only drive the CLI when invoked directly. Importing this module (e.g. from
// tests) must not kick off a scaffold or touch process.exitCode.
if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (err) {
    reportError(err);
  }
}
