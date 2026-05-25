import pc from "picocolors";
import prompts from "prompts";
import { detectPm, type PackageManager } from "./pm.ts";
import type { Provider, ScaffoldOptions } from "./scaffold.ts";

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
  partial: PartialOptions
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

  const providers = partial.providers ?? (await askProviders());

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
    install: partial.install ?? true,
    git: partial.git ?? true,
  };
}

async function askProviders(): Promise<Provider[]> {
  // Terminal is dev-only and grabs the TTY — mixing it with iMessage/WhatsApp
  // hides startup errors. Two-step prompt prevents the bad combo by construction.
  const { kind } = await prompts(
    {
      type: "select",
      name: "kind",
      message: "Project kind",
      choices: [
        {
          title: "Terminal",
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
    return ["terminal"];
  }

  const { values } = await prompts(
    {
      type: "multiselect",
      name: "values",
      message: "Which interfaces",
      hint: "space to toggle · enter to confirm",
      instructions: false,
      choices: [
        { title: "iMessage", value: "imessage", selected: true },
        { title: "WhatsApp Business", value: "whatsapp" },
      ],
      min: 1,
    },
    { onCancel }
  );

  return values as Provider[];
}
