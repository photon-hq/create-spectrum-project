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
  type ProviderEnvVar,
  templatesDir,
} from "./templates.ts";

/**
 * The dev-only TUI provider. Special-cased throughout: it doesn't need
 * top-level Spectrum credentials, and it can't be mixed with platform
 * providers (its TUI grabs the terminal and would hide startup errors
 * from concurrent providers). Hardcoded by name because these constraints
 * live in this CLI's UX, not in the spectrum-ts manifest.
 */
export const TERMINAL_KEY = "terminal";

/** A provider key as exposed by spectrum-ts's `manifest.json`. */
export type Provider = string;

export interface ManifestEntry {
  /** Exported const name to import (e.g. "whatsappBusiness"). */
  import: string;
  /** Provider key — also the npm subpath segment (e.g. "whatsapp-business"). */
  key: string;
  /** Human-readable label (e.g. "WhatsApp Business"). */
  label: string;
  /** Full bare-specifier import path (e.g. "spectrum-ts/providers/whatsapp-business"). */
  path: string;
}

export type Manifest = ManifestEntry[];

export interface ScaffoldOptions {
  credentials?: { projectId: string; projectSecret: string };
  git?: boolean;
  install?: boolean;
  logger?: ScaffoldLogger;
  /**
   * Provider manifest fetched from `spectrum-ts/manifest.json`. Callers should
   * use {@link fetchManifest} to get this. Required so scaffold() never has to
   * hit the network itself — keeps the function synchronously testable.
   */
  manifest: Manifest;
  name?: string;
  packageManager?: PackageManager;
  providers: Provider[];
  resolveSpectrumTsVersion?: () => Promise<string>;
  skills?: boolean;
  skillsRunner?: SkillsRunner;
  targetDir: string;
}

export interface ScaffoldResult {
  needsEnvFile: boolean;
  /**
   * Whether the .env has provider-specific vars (e.g. TELEGRAM_BOT_TOKEN) that
   * cloud provisioning can't fill — it only supplies PROJECT_ID/PROJECT_SECRET.
   * Drives whether the "fill in .env" reminder is still needed after provisioning.
   */
  hasProviderEnvVars: boolean;
  spectrumTsVersion: string;
  steps: {
    copied: true;
    installed: boolean;
    skillsInstalled: boolean;
    gitInitialized: boolean;
  };
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

const SPECTRUM_SKILL = "spectrum";

export type SkillsRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<number>;

const MANIFEST_URL = "https://unpkg.com/spectrum-ts/manifest.json";

/**
 * Last-known-good manifest, bundled at create-spectrum-project release time so
 * scaffolds work offline / when unpkg is down. Updated by the same release
 * step that pins {@link FALLBACK_SPECTRUM_TS_VERSION}.
 */
export const FALLBACK_MANIFEST: Manifest = [
  {
    key: "imessage",
    import: "imessage",
    path: "spectrum-ts/providers/imessage",
    label: "iMessage",
  },
  {
    key: "slack",
    import: "slack",
    path: "spectrum-ts/providers/slack",
    label: "Slack",
  },
  {
    key: "telegram",
    import: "telegram",
    path: "spectrum-ts/providers/telegram",
    label: "Telegram",
  },
  {
    key: "terminal",
    import: "terminal",
    path: "spectrum-ts/providers/terminal",
    label: "Terminal",
  },
  {
    key: "whatsapp-business",
    import: "whatsappBusiness",
    path: "spectrum-ts/providers/whatsapp-business",
    label: "WhatsApp Business",
  },
];

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    typeof entry.import === "string" &&
    typeof entry.path === "string" &&
    typeof entry.label === "string"
  );
}

/**
 * Fetch the spectrum-ts provider manifest from unpkg, falling back to the
 * bundled snapshot on any network/parse failure.
 *
 * Pulled out of {@link scaffold} so the bin can fetch once at startup,
 * validate `--providers` flag input against the live list, and feed the
 * same manifest into prompts and scaffold without duplicate network calls.
 */
export async function fetchManifest(
  logger?: ScaffoldLogger,
): Promise<Manifest> {
  try {
    const res = await fetch(MANIFEST_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`unpkg responded ${res.status}`);
    }
    const data: unknown = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("manifest is not an array");
    }
    for (const entry of data) {
      if (!isManifestEntry(entry)) {
        throw new Error(`malformed manifest entry: ${JSON.stringify(entry)}`);
      }
    }
    return data;
  } catch (err) {
    logger?.warn(
      `Could not fetch spectrum-ts manifest from ${MANIFEST_URL} (${
        err instanceof Error ? err.message : String(err)
      }); using bundled fallback (${FALLBACK_MANIFEST.length} providers).`,
    );
    return FALLBACK_MANIFEST;
  }
}

const NOOP_LOGGER: ScaffoldLogger = {
  step: (msg) => process.stderr.write(`${msg}\n`),
  warn: (msg) => process.stderr.write(`warn: ${msg}\n`),
  stream: (chunk) => process.stderr.write(chunk),
};

export async function scaffold(
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  if (options.providers.length === 0) {
    throw new Error("scaffold: providers must include at least one entry");
  }

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
    logger,
  );

  const assembly = assembleProviders(options.providers, options.manifest);

  const tokens = buildTokens({ name, spectrumTsVersion, assembly, pm });

  // Scaffold into a temp dir on the same filesystem as the target, so the
  // final rename can never cross filesystems (EXDEV on Linux when /tmp is
  // tmpfs but the target lives on /home, etc.).
  const targetParent = dirname(targetDir);
  await mkdir(targetParent, { recursive: true });
  const tmp = await mkdtemp(join(targetParent, ".create-spectrum-project-"));
  let copied = false;
  try {
    logger.step("Copying template…");
    await copyAndTransform(templatesDir(), tmp, tokens, {
      emitEnvFile: assembly.needsEnvFile,
    });

    if (assembly.needsEnvFile) {
      await writeFile(
        join(tmp, ".env"),
        buildEnvFile(assembly, options.credentials),
      );
    }

    await rename(tmp, targetDir);
    copied = true;
  } finally {
    if (!copied) {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  // Kick off the skill install right after template copy so it runs
  // concurrently with `pm install`. Awaited before git init so the resulting
  // files land in the initial commit.
  const skillsPromise =
    options.skills !== false
      ? trySkillsInstall(
          targetDir,
          options.skillsRunner ?? defaultSkillsRunner,
          logger,
        )
      : Promise.resolve(false);

  let installed = false;
  if (options.install !== false) {
    logger.step(`Running ${installCmd(pm)}…`);
    // Throws on failure: install is required for the project to run.
    await runInstall(pm, targetDir, logger);
    installed = true;
  }

  if (options.skills !== false) {
    logger.step("Installing Spectrum skill…");
  }
  const skillsInstalled = await skillsPromise;

  let gitInitialized = false;
  if (options.git !== false) {
    logger.step("Initializing git…");
    // Warns on failure (no throw): git is a nice-to-have, not required.
    gitInitialized = await tryGitInit(targetDir, logger);
  }

  return {
    targetDir,
    spectrumTsVersion,
    needsEnvFile: assembly.needsEnvFile,
    hasProviderEnvVars: assembly.providerEnv.length > 0,
    steps: { copied: true, installed, skillsInstalled, gitInitialized },
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
  logger: ScaffoldLogger,
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
      }); using bundled fallback ${FALLBACK_SPECTRUM_TS_VERSION}.`,
    );
    if (!FALLBACK_SPECTRUM_TS_VERSION) {
      throw new VersionResolutionError(
        "No spectrum-ts fallback version available",
      );
    }
    return FALLBACK_SPECTRUM_TS_VERSION;
  }
}

/**
 * The actual `.env` (not the tracked `.env.example`): real credentials filled
 * in when we have them, blank placeholders otherwise. No comments — that's
 * what `.env.example` carries.
 */
function buildEnvFile(
  assembly: ProviderAssembly,
  credentials: ScaffoldOptions["credentials"],
): string {
  const lines: string[] = [];
  for (const k of assembly.topLevelEnvVars) {
    if (k === "PROJECT_ID" && credentials) {
      lines.push(`PROJECT_ID=${credentials.projectId}`);
    } else if (k === "PROJECT_SECRET" && credentials) {
      lines.push(`PROJECT_SECRET=${credentials.projectSecret}`);
    } else {
      lines.push(`${k}=`);
    }
  }
  for (const e of assembly.providerEnv) {
    lines.push(`${e.name}=`);
  }

  return `${lines.join("\n")}\n`;
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
      "# Top-level Spectrum credentials (from your Photon dashboard).",
    );
    for (const k of assembly.topLevelEnvVars) {
      envLines.push(`${k}=`);
    }
  }
  if (assembly.providerEnv.length > 0) {
    if (envLines.length > 0) {
      envLines.push("");
    }
    for (const e of assembly.providerEnv) {
      envLines.push(`# ${e.comment}.`);
      envLines.push(`${e.name}=`);
    }
  }
  const runtime = pmRuntimeTokens(pm);
  return {
    name,
    spectrumTsVersion,
    importsBlock: assembly.importsBlock,
    spectrumConfigBody: assembly.spectrumConfigBody,
    envBlock: envLines.join("\n"),
    providersHuman: assembly.providersHuman,
    pmInstallCmd: installCmd(pm),
    pmStartCmd: runScriptCmd(pm, "start"),
    startScript: runtime.startScript,
    devScript: runtime.devScript,
    extraDevDeps: runtime.extraDevDeps,
    tsTypes: runtime.tsTypes,
    envSetupBlock: buildEnvSetupBlock(
      assembly.topLevelEnvVars,
      assembly.providerEnv,
    ),
    // Agent-facing env section. Same copy for every provider that needs creds
    // — only varies on present/absent, so a const + ternary, not a builder.
    // The README path uses `envSetupBlock` (human-facing) instead.
    envAgentBlock: assembly.needsEnvFile ? ENV_AGENT_BLOCK : "",
  };
}

/**
 * Per-package-manager bits that get embedded into package.json / tsconfig.json.
 * Bun runs `.ts` directly; Node-based PMs need `tsx` to do the same.
 */
function pmRuntimeTokens(pm: PackageManager): {
  startScript: string;
  devScript: string;
  extraDevDeps: string;
  tsTypes: string;
} {
  if (pm === "bun") {
    return {
      startScript: "bun src/index.ts",
      devScript: "bun --watch src/index.ts",
      extraDevDeps: ',\n    "@types/bun": "latest"',
      tsTypes: '"bun", "node"',
    };
  }
  return {
    startScript: "tsx src/index.ts",
    devScript: "tsx watch src/index.ts",
    extraDevDeps: ',\n    "@types/node": "^22",\n    "tsx": "^4"',
    tsTypes: '"node"',
  };
}

const ENV_AGENT_BLOCK = `## Environment

This project reads secrets from \`.env\` (gitignored). **Do not read, write, or echo \`.env\`** — it contains credentials.

If startup fails with an authentication error, tell the user to verify their \`PROJECT_ID\` / \`PROJECT_SECRET\` at the [Photon dashboard](https://app.photon.codes).

`;

function buildEnvSetupBlock(
  top: string[],
  providerEnv: ProviderEnvVar[],
): string {
  if (top.length === 0 && providerEnv.length === 0) {
    return "";
  }
  const lines: string[] = [
    "## Environment",
    "",
    "Before running, open `.env` and fill in the values:",
    "",
  ];
  if (top.length > 0) {
    lines.push(
      "From your project Settings on the [Photon dashboard](https://app.photon.codes):",
    );
    lines.push("");
    for (const k of top) {
      lines.push(`- \`${k}\``);
    }
    lines.push("");
  }
  for (const e of providerEnv) {
    lines.push(`From ${e.source}:`);
    lines.push("");
    lines.push(`- \`${e.name}\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function spawnExit(
  command: string,
  args: readonly string[],
  opts: SpawnOptions,
  onChunk?: (s: string) => void,
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
  logger: ScaffoldLogger,
): Promise<void> {
  const args = pm === "yarn" ? [] : ["install"];
  const exitCode = await spawnExit(pm, args, { cwd }, (chunk) =>
    logger.stream(chunk),
  );
  if (exitCode !== 0) {
    throw new InstallError(
      `\`${pm} ${args.join(" ")}\` exited with code ${exitCode}`,
      exitCode,
    );
  }
}

async function tryGitInit(
  cwd: string,
  logger: ScaffoldLogger,
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
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "create-spectrum-project",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "noreply@photon.codes",
      GIT_COMMITTER_NAME:
        process.env.GIT_COMMITTER_NAME ?? "create-spectrum-project",
      GIT_COMMITTER_EMAIL:
        process.env.GIT_COMMITTER_EMAIL ?? "noreply@photon.codes",
    };
    const commitExit = await spawnExit(
      "git",
      [
        "commit",
        "-m",
        "Initial commit from create-spectrum-project",
        "--no-verify",
      ],
      { cwd, env: commitEnv },
    );
    if (commitExit !== 0) {
      logger.warn("git commit failed; repo initialized but no initial commit.");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      `git not available: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function trySkillsInstall(
  cwd: string,
  runner: SkillsRunner,
  logger: ScaffoldLogger,
): Promise<boolean> {
  try {
    // Pre-create .claude/ so the `claude-code` agent gets a
    // .claude/skills/spectrum symlink. Without this dir present at install
    // time, the CLI only writes the universal .agents/skills/ path and
    // Claude Code does not auto-discover the skill.
    await mkdir(join(cwd, ".claude"), { recursive: true });
    // Install only into the universal (.agents/skills) and Claude Code
    // (.claude/skills) directories. Using `--agent '*'` would fan out to
    // every agent in the registry, including ones nobody here uses — e.g.
    // Eve, whose skills dir is a bare `agent/skills`, leaving a stray
    // `agent/` folder in every scaffolded repo.
    const args = [
      "-y",
      "skills",
      "add",
      "photon-hq/skills",
      "--skill",
      SPECTRUM_SKILL,
      "-a",
      "universal",
      "-y",
    ] as const;
    const exit = await runner(args, cwd);
    if (exit !== 0) {
      logger.warn(`Spectrum skill install exited ${exit}; skipping.`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      `Spectrum skill install unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

const defaultSkillsRunner: SkillsRunner = (args, cwd) => {
  const runner = typeof process.versions.bun === "string" ? "bunx" : "npx";
  return spawnExit(runner, args, { cwd });
};
