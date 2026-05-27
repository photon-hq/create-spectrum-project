import pc from "picocolors";
import prompts from "prompts";
import { detectPm, type PackageManager } from "./pm.ts";
import type { Manifest, Provider, ScaffoldOptions } from "./scaffold.ts";
import { TERMINAL_KEY } from "./scaffold.ts";

export interface PartialOptions {
  git?: boolean;
  install?: boolean;
  packageManager?: PackageManager;
  providers?: Provider[];
  skills?: boolean;
  targetDir?: string;
}

const onCancel = () => {
  process.stderr.write(`\n${pc.dim("Cancelled.")}\n`);
  process.exit(130);
};

export async function promptForOptions(
  partial: PartialOptions,
  manifest: Manifest
): Promise<ScaffoldOptions> {
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
        { onCancel }
      )
    ).value;

  const providers = partial.providers ?? (await askProviders(manifest));

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
        { onCancel }
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
        { onCancel }
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
        { onCancel }
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
        { onCancel }
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
  };
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
    { onCancel }
  );

  if (kind === "terminal") {
    return [terminal.key];
  }
  return askPlatformProviders(platformProviders);
}

async function askPlatformProviders(
  platformProviders: Manifest
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
    { onCancel }
  );
  return values as Provider[];
}
