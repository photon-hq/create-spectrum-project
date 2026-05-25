#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spinner as createSpinner, intro, log, outro } from "@clack/prompts";
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

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      providers: { type: "string" },
      "imessage-mode": { type: "string" },
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

  if (values.help) {
    printHelp();
    return 0;
  }
  if (values.version) {
    process.stdout.write(`create-spectrum-app ${await readOwnVersion()}\n`);
    return 0;
  }

  const partial: PartialOptions = {};
  if (positionals[0]) {
    partial.targetDir = positionals[0];
  }
  if (values.providers) {
    partial.providers = parseProviders(values.providers);
  }
  if (values["imessage-mode"]) {
    const mode = values["imessage-mode"];
    if (mode !== "cloud" && mode !== "local") {
      fail(`--imessage-mode must be "cloud" or "local"`);
    }
    partial.imessageMode = mode;
  }
  if (values.pm) {
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

  intro(pc.bgCyan(pc.black(" create-spectrum-app ")));

  const opts = values.yes
    ? fillDefaults(partial)
    : await promptForOptions(partial);

  const spinner = createSpinner();
  spinner.start("Scaffolding…");
  const result = await scaffold({
    ...opts,
    logger: {
      step: (msg) => spinner.message(msg),
      warn: (msg) => log.warn(msg),
      stream: (chunk) => {
        if (values.verbose) {
          process.stderr.write(chunk);
        }
      },
    },
  });
  spinner.stop("Project scaffolded.");

  printNextSteps(result, opts);
  outro(pc.green("All set."));
  return 0;
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
    imessageMode:
      partial.imessageMode ??
      (providers.includes("imessage") ? "cloud" : undefined),
    packageManager: partial.packageManager,
    install: partial.install ?? true,
    git: partial.git ?? true,
  } satisfies PartialOptions & { targetDir: string; providers: Provider[] };
}

function printNextSteps(
  result: {
    targetDir: string;
    steps: { installed: boolean; gitInitialized: boolean };
  },
  opts: { packageManager?: PackageManager }
): void {
  const pm = opts.packageManager ?? "bun";
  const lines = ["", "Next steps:", `  cd ${result.targetDir}`];
  if (!result.steps.installed) {
    lines.push(`  ${pm === "yarn" ? "yarn" : `${pm} install`}`);
  }
  lines.push(`  ${pm === "npm" ? "npm run start" : `${pm} start`}`);
  lines.push("");
  process.stdout.write(lines.join("\n"));
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: create-spectrum-app [directory] [options]",
      "",
      "Options:",
      "  --providers <list>      Comma-separated: terminal,imessage,whatsapp",
      "  --imessage-mode <m>     cloud | local (default: cloud)",
      "  --pm <m>                bun | npm | pnpm | yarn (default: detected)",
      "  --no-install            Skip dependency install",
      "  --no-git                Skip git init",
      "  -y, --yes               Use defaults; skip interactive prompts",
      "  --verbose               Stream install stdout/stderr",
      "  -h, --help              Show this help",
      "  --version               Show version",
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
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof TargetExistsError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  } else if (err instanceof InstallError) {
    process.stderr.write(
      `error: install failed (exit ${err.exitCode}). cd into the project and run install manually to retry.\n`
    );
    process.exitCode = 1;
  } else if (err instanceof VersionResolutionError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  } else if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    if (process.argv.includes("--verbose") && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stderr.write(`error: ${String(err)}\n`);
    process.exitCode = 1;
  }
}
