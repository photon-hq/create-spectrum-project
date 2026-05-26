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

  return {
    targetDir,
    providers,
    packageManager,
    manifest,
    install: partial.install ?? true,
    git: partial.git ?? true,
  };
}

async function askProviders(manifest: Manifest): Promise<Provider[]> {
  // Terminal is dev-only and grabs the TTY — mixing it with production
  // providers would hide startup errors behind the TUI. The fork prevents
  // the bad combo by construction.
  const terminal = manifest.find((m) => m.key === TERMINAL_KEY);
  const productionProviders = manifest.filter((m) => m.key !== TERMINAL_KEY);

  if (!terminal) {
    // No terminal in the manifest — degenerate case; just multiselect prod.
    return askProductionProviders(productionProviders);
  }
  if (productionProviders.length === 0) {
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
          title: terminal.label,
          description: "local dev / test TUI, no credentials",
          value: "terminal",
        },
        {
          title: "Production",
          description: "pick one or more messaging interfaces",
          value: "production",
        },
      ],
      initial: 0,
    },
    { onCancel }
  );

  if (kind === "terminal") {
    return [terminal.key];
  }
  return askProductionProviders(productionProviders);
}

async function askProductionProviders(
  productionProviders: Manifest
): Promise<Provider[]> {
  const { values } = await prompts(
    {
      type: "multiselect",
      name: "values",
      message: "Which interfaces (space to toggle, enter to confirm)",
      instructions: false,
      choices: productionProviders.map((m, i) => ({
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
