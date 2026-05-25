#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { isPm, type PackageManager } from "./pm.ts";
import { type PartialOptions, promptForOptions } from "./prompts.ts";
import {
  InstallError,
  type Provider,
  scaffold,
  TargetExistsError,
  VersionResolutionError,
} from "./scaffold.ts";

const SYM = {
  ok: pc.green("✓"),
  err: pc.red("✗"),
  arrow: pc.dim("→"),
  dot: pc.dim("·"),
};

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      providers: { type: "string" },
      pm: { type: "string" },
      install: { type: "boolean", default: true },
      "no-install": { type: "boolean" },
      git: { type: "boolean", default: true },
      "no-git": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });

  const version = await readOwnVersion();

  if (values.help) {
    printHelp();
    return 0;
  }
  if (values.version) {
    process.stdout.write(`create-spectrum-app ${version}\n`);
    return 0;
  }

  const partial = collectFlagOptions(values, positionals);

  process.stdout.write(
    `\n${pc.bold("create-spectrum-app")} ${pc.dim(`v${version}`)}\n\n`
  );

  const opts = values.yes
    ? fillDefaults(partial)
    : await promptForOptions(partial);

  // One blank line of breathing room before the spinner — only after prompts,
  // since the -y path already has its own blank between the banner and the spinner.
  if (!values.yes) {
    process.stdout.write("\n");
  }

  const start = Date.now();
  const spin = startSpinner();
  let result: Awaited<ReturnType<typeof scaffold>>;
  try {
    result = await scaffold({
      ...opts,
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

  printNextSteps(result, opts);
  process.stdout.write(
    `\n${SYM.arrow} ${pc.dim("Docs:")} ${pc.cyan("https://photon.codes/docs/spectrum-ts")}\n\n`
  );
  return 0;
}

function collectFlagOptions(
  values: Record<string, unknown>,
  positionals: string[]
): PartialOptions {
  const partial: PartialOptions = {};
  if (positionals[0]) {
    partial.targetDir = positionals[0];
  }
  if (typeof values.providers === "string") {
    partial.providers = parseProviders(values.providers);
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
  return partial;
}

function parseProviders(raw: string): Provider[] {
  const valid: Provider[] = ["terminal", "imessage", "whatsapp"];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!(valid as string[]).includes(p)) {
      fail(`Unknown provider: ${p}`);
    }
  }
  if (parts.length === 0) {
    fail("--providers must list at least one provider");
  }
  if (parts.includes("terminal") && parts.length > 1) {
    fail(
      "terminal is a dev-only TUI and can't be mixed with iMessage / WhatsApp. Pick terminal on its own, or just iMessage and/or WhatsApp."
    );
  }
  return parts as Provider[];
}

function fillDefaults(partial: PartialOptions) {
  const providers = partial.providers ?? (["terminal"] as Provider[]);
  return {
    targetDir: partial.targetDir ?? "my-spectrum-app",
    providers,
    packageManager: partial.packageManager,
    install: partial.install ?? true,
    git: partial.git ?? true,
  } satisfies PartialOptions & { targetDir: string; providers: Provider[] };
}

function printNextSteps(
  result: {
    needsEnvFile: boolean;
    steps: { installed: boolean; gitInitialized: boolean };
    targetDir: string;
  },
  opts: { packageManager?: PackageManager }
): void {
  const pm = opts.packageManager ?? "bun";
  const cwd = basename(result.targetDir);

  interface Step {
    cmd: string;
    comment?: string;
  }
  const steps: Step[] = [{ cmd: `cd ${cwd}` }];
  if (!result.steps.installed) {
    steps.push({ cmd: pm === "yarn" ? "yarn" : `${pm} install` });
  }
  if (result.needsEnvFile) {
    steps.push({
      cmd: "cp .env.example .env",
      comment: "add your credentials",
    });
  }
  steps.push({ cmd: pm === "npm" ? "npm run start" : `${pm} start` });

  process.stdout.write(`\n${pc.bold("Next steps")}\n`);
  for (const { cmd, comment } of steps) {
    const line = comment
      ? `  ${pc.dim("$")} ${cmd}  ${pc.dim(`# ${comment}`)}`
      : `  ${pc.dim("$")} ${cmd}`;
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
      pad(`${flag("--providers")} <list>`),
      "Comma-separated: terminal,imessage,whatsapp",
    ],
    [
      pad(`${flag("--pm")} <m>`),
      `bun | npm | pnpm | yarn ${dim("(default: detected)")}`,
    ],
    [pad(flag("--no-install")), "Skip dependency install"],
    [pad(flag("--no-git")), "Skip git init"],
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
      `    ${dim("$")} create-spectrum-app ${dim("[directory] [options]")}`,
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

try {
  process.exitCode = await main();
} catch (err) {
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
