import {
  cancel,
  isCancel,
  log,
  multiselect,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { detectPm, type PackageManager } from "./pm.ts";
import type { ImessageMode, Provider, ScaffoldOptions } from "./scaffold.ts";

export interface PartialOptions {
  git?: boolean;
  imessageMode?: ImessageMode;
  install?: boolean;
  packageManager?: PackageManager;
  providers?: Provider[];
  targetDir?: string;
}

export async function promptForOptions(
  partial: PartialOptions
): Promise<ScaffoldOptions> {
  const targetDir =
    partial.targetDir ??
    (await unwrap(
      text({
        message: "Project directory?",
        placeholder: "my-spectrum-app",
        defaultValue: "my-spectrum-app",
      })
    ));

  const providers = partial.providers ?? (await promptForProviders());

  let imessageMode: ImessageMode | undefined = partial.imessageMode;
  if (providers.includes("imessage") && !imessageMode) {
    if (process.platform === "darwin") {
      imessageMode = await unwrap(
        select<ImessageMode>({
          message: "iMessage mode?",
          options: [
            {
              value: "cloud",
              label: "Cloud",
              hint: "managed; needs PROJECT_ID / PROJECT_SECRET",
            },
            {
              value: "local",
              label: "Local",
              hint: "macOS only; reads Messages.app DB directly",
            },
          ],
          initialValue: "cloud",
        })
      );
    } else {
      imessageMode = "cloud";
    }
  }

  if (providers.includes("imessage") && imessageMode === "local") {
    printLocalImessageWarning();
  }

  const packageManager =
    partial.packageManager ??
    (await unwrap(
      select<PackageManager>({
        message: "Package manager?",
        options: [
          { value: "bun", label: "bun" },
          { value: "npm", label: "npm" },
          { value: "pnpm", label: "pnpm" },
          { value: "yarn", label: "yarn" },
        ],
        initialValue: detectPm() ?? "bun",
      })
    ));

  // Install and git default to true; opt out via --no-install / --no-git.
  return {
    targetDir,
    providers,
    imessageMode,
    packageManager,
    install: partial.install ?? true,
    git: partial.git ?? true,
  };
}

async function promptForProviders(): Promise<Provider[]> {
  // Terminal is dev-only and grabs the TTY — mixing it with iMessage/WhatsApp
  // hides startup errors behind the TUI. Force a kind/interface fork so the
  // bad combo can't be picked.
  const kind = await unwrap(
    select<"terminal" | "production">({
      message: "What kind of project?",
      options: [
        {
          value: "terminal",
          label: "Terminal",
          hint: "local dev / test TUI, no credentials needed",
        },
        {
          value: "production",
          label: "Production",
          hint: "pick one or more messaging interfaces",
        },
      ],
      initialValue: "terminal",
    })
  );
  if (kind === "terminal") {
    return ["terminal"];
  }

  return (await unwrap(
    multiselect<Exclude<Provider, "terminal">>({
      message: "Which interfaces? (space to toggle, enter to confirm)",
      options: [
        { value: "imessage", label: "iMessage" },
        { value: "whatsapp", label: "WhatsApp Business" },
      ],
      initialValues: ["imessage"],
      required: true,
    })
  )) as Provider[];
}

async function unwrap<T>(promise: Promise<T | symbol>): Promise<T> {
  const value = await promise;
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(130);
  }
  return value as T;
}

function printLocalImessageWarning(): void {
  const note = pc.yellow(
    [
      "",
      "⚠  Local iMessage mode requirements:",
      "   • macOS only (reads ~/Library/Messages/chat.db directly)",
      "   • Your terminal needs Full Disk Access:",
      "     System Settings → Privacy & Security → Full Disk Access",
      "   • Reduced features: text + attachments only",
      "     (no reactions, typing indicators, threaded replies, group ops)",
      "",
    ].join("\n")
  );
  log.warn(note);
}
