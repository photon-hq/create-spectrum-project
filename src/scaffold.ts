import { type SpawnOptions, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  detectPm,
  installCmd,
  type PackageManager,
  runScriptCmd,
} from "./pm.ts";
import {
  assembleProviders,
  copyAndTransform,
  type ProviderAssembly,
  templatesDir,
} from "./templates.ts";

export type Provider = "terminal" | "imessage" | "whatsapp";
export type ImessageMode = "cloud" | "local";

export interface ScaffoldOptions {
  credentials?: { projectId: string; projectSecret: string };
  git?: boolean;
  imessageMode?: ImessageMode;
  install?: boolean;
  logger?: ScaffoldLogger;
  name?: string;
  packageManager?: PackageManager;
  providers: Provider[];
  resolveSpectrumTsVersion?: () => Promise<string>;
  targetDir: string;
}

export interface ScaffoldResult {
  spectrumTsVersion: string;
  steps: { copied: true; installed: boolean; gitInitialized: boolean };
  targetDir: string;
}

export interface ScaffoldLogger {
  step(msg: string): void;
  stream(chunk: string): void;
  warn(msg: string): void;
}

export class TargetExistsError extends Error {
  override name = "TargetExistsError";
}
export class VersionResolutionError extends Error {
  override name = "VersionResolutionError";
}
export class InstallError extends Error {
  override name = "InstallError";
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export const FALLBACK_SPECTRUM_TS_VERSION = "^0.0.0";

const NOOP_LOGGER: ScaffoldLogger = {
  step: (msg) => process.stderr.write(`${msg}\n`),
  warn: (msg) => process.stderr.write(`warn: ${msg}\n`),
  stream: (chunk) => process.stderr.write(chunk),
};

export async function scaffold(
  options: ScaffoldOptions
): Promise<ScaffoldResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  if (options.providers.length === 0) {
    throw new Error("scaffold: providers must include at least one entry");
  }
  const imessageMode: ImessageMode = options.imessageMode ?? "cloud";

  const targetDir = isAbsolute(options.targetDir)
    ? options.targetDir
    : resolve(process.cwd(), options.targetDir);
  const name = options.name ?? basename(targetDir);
  const pm = options.packageManager ?? detectPm() ?? "bun";

  if (await isNonEmptyDir(targetDir)) {
    throw new TargetExistsError(`Target directory is not empty: ${targetDir}`);
  }

  logger.step("Resolving spectrum-ts version…");
  const spectrumTsVersion = await resolveVersion(
    options.resolveSpectrumTsVersion,
    logger
  );

  const assembly = assembleProviders(options.providers, imessageMode);

  const tokens = buildTokens({ name, spectrumTsVersion, assembly, pm });

  // Scaffold into a temp dir on the same filesystem as the target, so the
  // final rename can never cross filesystems (EXDEV on Linux when /tmp is
  // tmpfs but the target lives on /home, etc.).
  const targetParent = dirname(targetDir);
  await mkdir(targetParent, { recursive: true });
  const tmp = await mkdtemp(join(targetParent, ".create-spectrum-app-"));
  let copied = false;
  try {
    logger.step("Copying template…");
    await copyAndTransform(templatesDir(), tmp, tokens, {
      emitEnvFile: assembly.needsEnvFile,
    });

    if (options.credentials && assembly.needsEnvFile) {
      const realEnv = [
        `PROJECT_ID=${options.credentials.projectId}`,
        `PROJECT_SECRET=${options.credentials.projectSecret}`,
        ...assembly.providerEnvVars.map((k) => `${k}=`),
      ].join("\n");
      await writeFile(join(tmp, ".env"), realEnv);
    }

    await rename(tmp, targetDir);
    copied = true;
  } finally {
    if (!copied) {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  let installed = false;
  if (options.install !== false) {
    logger.step(`Running ${installCmd(pm)}…`);
    // Throws on failure: install is required for the project to run.
    await runInstall(pm, targetDir, logger);
    installed = true;
  }

  let gitInitialized = false;
  if (options.git !== false) {
    logger.step("Initializing git…");
    // Warns on failure (no throw): git is a nice-to-have, not required.
    gitInitialized = await tryGitInit(targetDir, logger);
  }

  return {
    targetDir,
    spectrumTsVersion,
    steps: { copied: true, installed, gitInitialized },
  };
}

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length > 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

const NPM_REGISTRY = "https://registry.npmjs.org/spectrum-ts";

async function resolveVersion(
  override: (() => Promise<string>) | undefined,
  logger: ScaffoldLogger
): Promise<string> {
  try {
    if (override) {
      return await override();
    }
    const res = await fetch(NPM_REGISTRY, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`registry responded ${res.status}`);
    }
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
    const latest = data["dist-tags"]?.latest;
    if (!latest) {
      throw new Error("registry response missing dist-tags.latest");
    }
    return `^${latest}`;
  } catch (err) {
    logger.warn(
      `Could not resolve spectrum-ts version from npm (${
        err instanceof Error ? err.message : String(err)
      }); using bundled fallback ${FALLBACK_SPECTRUM_TS_VERSION}.`
    );
    if (!FALLBACK_SPECTRUM_TS_VERSION) {
      throw new VersionResolutionError(
        "No spectrum-ts fallback version available"
      );
    }
    return FALLBACK_SPECTRUM_TS_VERSION;
  }
}

function buildTokens(args: {
  name: string;
  spectrumTsVersion: string;
  assembly: ProviderAssembly;
  pm: PackageManager;
}) {
  const { name, spectrumTsVersion, assembly, pm } = args;
  const envLines: string[] = [];
  if (assembly.topLevelEnvVars.length > 0) {
    envLines.push(
      "# Top-level Spectrum credentials (from your Photon dashboard)."
    );
    for (const k of assembly.topLevelEnvVars) {
      envLines.push(`${k}=`);
    }
  }
  if (assembly.providerEnvVars.length > 0) {
    if (envLines.length > 0) {
      envLines.push("");
    }
    envLines.push("# WhatsApp Business (from Meta for Developers).");
    for (const k of assembly.providerEnvVars) {
      envLines.push(`${k}=`);
    }
  }
  return {
    name,
    spectrumTsVersion,
    importsBlock: assembly.importsBlock,
    spectrumConfigBody: assembly.spectrumConfigBody,
    envBlock: envLines.join("\n"),
    providersHuman: assembly.providersHuman,
    pmInstallCmd: installCmd(pm),
    pmStartCmd: runScriptCmd(pm, "start"),
    envSetupBlock: buildEnvSetupBlock(
      assembly.topLevelEnvVars,
      assembly.providerEnvVars
    ),
    imessageLocalHintBlock: assembly.hasImessageLocal
      ? buildImessageLocalHint()
      : "",
  };
}

function buildEnvSetupBlock(top: string[], provider: string[]): string {
  if (top.length === 0 && provider.length === 0) {
    return "";
  }
  const lines: string[] = [
    "## Environment",
    "",
    "Before running, copy `.env.example` to `.env` and fill in the values:",
    "",
    "```sh",
    "cp .env.example .env",
    "```",
    "",
  ];
  if (top.length > 0) {
    lines.push(
      "From your project Settings on the [Photon dashboard](https://photon.codes):"
    );
    lines.push("");
    for (const k of top) {
      lines.push(`- \`${k}\``);
    }
    lines.push("");
  }
  if (provider.length > 0) {
    lines.push(
      "From [Meta for Developers](https://developers.facebook.com) (WhatsApp Business):"
    );
    lines.push("");
    for (const k of provider) {
      lines.push(`- \`${k}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function spawnExit(
  command: string,
  args: readonly string[],
  opts: SpawnOptions,
  onChunk?: (s: string) => void
): Promise<number> {
  return new Promise((resolveExit, rejectSpawn) => {
    const stdio: SpawnOptions["stdio"] = onChunk
      ? ["ignore", "pipe", "pipe"]
      : ["ignore", "ignore", "ignore"];
    const proc = spawn(command, args as string[], { ...opts, stdio });
    if (onChunk) {
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", onChunk);
      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", onChunk);
    }
    proc.once("error", rejectSpawn);
    proc.once("close", (code) => resolveExit(code ?? -1));
  });
}

async function runInstall(
  pm: PackageManager,
  cwd: string,
  logger: ScaffoldLogger
): Promise<void> {
  const args = pm === "yarn" ? [] : ["install"];
  const exitCode = await spawnExit(pm, args, { cwd }, (chunk) =>
    logger.stream(chunk)
  );
  if (exitCode !== 0) {
    throw new InstallError(
      `\`${pm} ${args.join(" ")}\` exited with code ${exitCode}`,
      exitCode
    );
  }
}

async function tryGitInit(
  cwd: string,
  logger: ScaffoldLogger
): Promise<boolean> {
  try {
    if ((await spawnExit("git", ["init", "-b", "main"], { cwd })) !== 0) {
      logger.warn("git init failed; skipping git setup.");
      return false;
    }
    if ((await spawnExit("git", ["add", "."], { cwd })) !== 0) {
      logger.warn("git add failed; skipping initial commit.");
      return false;
    }
    const commitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "create-spectrum-app",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "noreply@photon.codes",
      GIT_COMMITTER_NAME:
        process.env.GIT_COMMITTER_NAME ?? "create-spectrum-app",
      GIT_COMMITTER_EMAIL:
        process.env.GIT_COMMITTER_EMAIL ?? "noreply@photon.codes",
    };
    const commitExit = await spawnExit(
      "git",
      [
        "commit",
        "-m",
        "Initial commit from create-spectrum-app",
        "--no-verify",
      ],
      { cwd, env: commitEnv }
    );
    if (commitExit !== 0) {
      logger.warn("git commit failed; repo initialized but no initial commit.");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      `git not available: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

function buildImessageLocalHint(): string {
  return `${[
    "## Local iMessage mode",
    "",
    "Requires:",
    "",
    "- macOS only (reads `~/Library/Messages/chat.db` directly)",
    "- Your terminal needs **Full Disk Access**: System Settings → Privacy & Security → Full Disk Access",
    "- Reduced features: text + attachments only (no reactions, typing indicators, threaded replies, group ops)",
    "",
  ].join("\n")}\n`;
}
