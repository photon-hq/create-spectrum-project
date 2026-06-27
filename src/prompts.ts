import pc from "picocolors";
import prompts from "prompts";
import { detectPm, type PackageManager } from "./pm.ts";
import type { Manifest, Provider, ScaffoldOptions } from "./scaffold.ts";
import { TERMINAL_KEY } from "./scaffold.ts";

export interface PartialOptions {
  cloud?: boolean;
  git?: boolean;
  install?: boolean;
  packageManager?: PackageManager;
  projectId?: string;
  providers?: Provider[];
  skills?: boolean;
  targetDir?: string;
}

export type PromptResult = ScaffoldOptions & {
  projectId?: string;
  provisionCloud: boolean;
  /**
   * For an existing `projectId`: whether to rotate (regenerate) its secret.
   * `undefined` when no project was pinned (a fresh project always mints).
   */
  rotateSecret?: boolean;
};

const onCancel = () => {
  process.stderr.write(`\n${pc.dim("Cancelled.")}\n`);
  process.exit(130);
};

export async function promptForOptions(
  partial: PartialOptions,
  manifest: Manifest,
): Promise<PromptResult> {
  const targetDir =
    partial.targetDir ??
    (
      await prompts(
        {
          type: "text",
          name: "value",
          message: "Project directory",
          initial: "my-spectrum-app",
        },
        { onCancel },
      )
    ).value;

  const providers = partial.providers ?? (await askProviders(manifest));

  const provisionCloud = await askSetUpCloud(providers, partial);

  // Pinning an existing project mints a fresh secret by rotating it, which
  // invalidates the old one. Check before doing something destructive.
  const rotateSecret = partial.projectId ? await askRotateSecret() : undefined;

  const detected = detectPm() ?? "bun";
  const pmChoices: PackageManager[] = ["bun", "npm", "pnpm", "yarn"];
  const packageManager =
    partial.packageManager ??
    (
      await prompts(
        {
          type: "select",
          name: "value",
          message: "Package manager",
          choices: pmChoices.map((p) => ({ title: p, value: p })),
          initial: pmChoices.indexOf(detected),
        },
        { onCancel },
      )
    ).value;

  // Three yes/no prompts in pipeline order (install → skill → git). Each one
  // short-circuits if its corresponding --no-* flag was passed, so the CLI
  // surface stays: flag opts out, no flag asks, default is always yes.
  const install =
    partial.install ??
    (
      await prompts(
        {
          type: "confirm",
          name: "value",
          message: "Install dependencies?",
          initial: true,
        },
        { onCancel },
      )
    ).value;

  const skills =
    partial.skills ??
    (
      await prompts(
        {
          type: "confirm",
          name: "value",
          message: "Install Spectrum skill for AI agents?",
          initial: true,
        },
        { onCancel },
      )
    ).value;

  const git =
    partial.git ??
    (
      await prompts(
        {
          type: "confirm",
          name: "value",
          message: "Initialize git?",
          initial: true,
        },
        { onCancel },
      )
    ).value;

  return {
    targetDir,
    providers,
    packageManager,
    manifest,
    install,
    git,
    skills,
    projectId: partial.projectId,
    provisionCloud,
    rotateSecret,
  };
}

/**
 * Caution gate for `--projectId`: provisioning rotates (regenerates) the
 * project's API secret so it can write a working one into `.env`.
 */
async function askRotateSecret(): Promise<boolean> {
  const { value } = await prompts(
    {
      type: "confirm",
      name: "value",
      message:
        "Heads up: this will rotate your project's secret and write it into " +
        ".env. Say No to keep your current secret and fill it in yourself.",
      initial: true,
    },
    { onCancel },
  );
  return value;
}

/**
 * Offer to set up Spectrum Cloud — create the project online and fill in .env.
 * Offered for any platform project (anything but the dev-only terminal): every
 * platform provider authenticates with the top-level Spectrum Cloud project
 * secret, which provisioning creates and writes into .env. `--no-cloud` opts
 * out. Returns false (no offer) for terminal-only projects.
 */
async function askSetUpCloud(
  providers: Provider[],
  partial: PartialOptions,
): Promise<boolean> {
  // An explicit --projectId is an unambiguous "yes, set up cloud with this
  // project"
  if (partial.projectId) {
    return true;
  }
  const hasPlatform = providers.some((p) => p !== TERMINAL_KEY);
  if (!hasPlatform || partial.cloud === false) {
    return false;
  }
  const { value } = await prompts(
    {
      type: "confirm",
      name: "value",
      message:
        "Set up Spectrum Cloud now? (creates your project and fills in .env)",
      initial: true,
    },
    { onCancel },
  );
  return value;
}

async function askProviders(manifest: Manifest): Promise<Provider[]> {
  // Terminal is dev-only and grabs the TTY — mixing it with platform
  // providers would hide startup errors behind the TUI. The fork prevents
  // the bad combo by construction.
  const terminal = manifest.find((m) => m.key === TERMINAL_KEY);
  const platformProviders = manifest.filter((m) => m.key !== TERMINAL_KEY);

  if (!terminal) {
    // No terminal in the manifest — degenerate case; just multiselect platforms.
    return askPlatformProviders(platformProviders);
  }
  if (platformProviders.length === 0) {
    // Only terminal available. Skip the fork.
    return [terminal.key];
  }

  const { kind } = await prompts(
    {
      type: "select",
      name: "kind",
      message: "Project kind",
      choices: [
        {
          title: "Platforms",
          description: "pick one or more messaging interfaces",
          value: "platform",
        },
        {
          title: terminal.label,
          description: "local dev / test TUI, no credentials",
          value: "terminal",
        },
      ],
      initial: 0,
    },
    { onCancel },
  );

  if (kind === "terminal") {
    return [terminal.key];
  }
  return askPlatformProviders(platformProviders);
}

async function askPlatformProviders(
  platformProviders: Manifest,
): Promise<Provider[]> {
  const { values } = await prompts(
    {
      type: "multiselect",
      name: "values",
      message: "Which interfaces (space to toggle, enter to confirm)",
      instructions: false,
      choices: platformProviders.map((m, i) => ({
        title: m.label,
        value: m.key,
        selected: i === 0,
      })),
      min: 1,
    },
    { onCancel },
  );
  return values as Provider[];
}
