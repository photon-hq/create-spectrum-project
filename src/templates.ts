import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "./scaffold.ts";

export interface ProviderAssembly {
  importsBlock: string;
  needsEnvFile: boolean;
  providerEnvVars: string[];
  providersHuman: string;
  spectrumConfigBody: string;
  topLevelEnvVars: string[];
}

export function assembleProviders(providers: Provider[]): ProviderAssembly {
  if (providers.length === 0) {
    throw new Error("assembleProviders: at least one provider required");
  }

  const imports = ['import { Spectrum } from "spectrum-ts";'];
  const providerLines: string[] = [];
  const topLevelEnvVars: string[] = [];
  const providerEnvVars: string[] = [];
  const humanParts: string[] = [];

  const hasImessage = providers.includes("imessage");

  // Deterministic emission order, independent of how the caller listed them.
  const ordered: Provider[] = (
    ["terminal", "imessage", "whatsapp"] as Provider[]
  ).filter((p) => providers.includes(p));

  for (const p of ordered) {
    if (p === "terminal") {
      imports.push(
        'import { terminal } from "spectrum-ts/providers/terminal";'
      );
      providerLines.push(
        "    // Terminal opens a chat TUI for local development — no credentials needed."
      );
      providerLines.push("    terminal.config(),");
      humanParts.push("terminal");
    } else if (p === "imessage") {
      imports.push(
        'import { imessage } from "spectrum-ts/providers/imessage";'
      );
      providerLines.push(
        "    // iMessage: tokens auto-renewed; lines managed in the Photon dashboard."
      );
      providerLines.push("    imessage.config(),");
      topLevelEnvVars.push("PROJECT_ID", "PROJECT_SECRET");
      humanParts.push("iMessage");
    } else if (p === "whatsapp") {
      imports.push(
        'import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";'
      );
      providerLines.push(
        "    // WhatsApp Business: 1:1 conversations via Meta Cloud API."
      );
      providerLines.push("    whatsappBusiness.config({");
      providerLines.push("      accessToken: process.env.WA_TOKEN!,");
      providerLines.push("      phoneNumberId: process.env.WA_NUMBER_ID!,");
      providerLines.push("      appSecret: process.env.WA_SECRET!,");
      providerLines.push("    }),");
      providerEnvVars.push("WA_TOKEN", "WA_NUMBER_ID", "WA_SECRET");
      humanParts.push("WhatsApp Business");
    }
  }

  const importsBlock = imports.join("\n");

  const configLines: string[] = [];
  if (hasImessage) {
    configLines.push("  projectId: process.env.PROJECT_ID!,");
    configLines.push("  projectSecret: process.env.PROJECT_SECRET!,");
  }
  configLines.push("  providers: [");
  configLines.push(...providerLines);
  configLines.push("  ],");
  const spectrumConfigBody = configLines.join("\n");

  return {
    importsBlock,
    spectrumConfigBody,
    topLevelEnvVars,
    providerEnvVars,
    needsEnvFile: topLevelEnvVars.length + providerEnvVars.length > 0,
    providersHuman: humanParts.join(", "),
  };
}

const TOKEN_RE = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

export function substitute(
  content: string,
  tokens: { readonly [key: string]: string }
): string {
  return content.replaceAll(TOKEN_RE, (_match, key: string) => {
    if (!(key in tokens)) {
      throw new Error(`Unknown template token: {{${key}}}`);
    }
    return tokens[key] ?? "";
  });
}

export function templatesDir(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "base"
  );
}

export interface CopyTokens {
  envBlock: string;
  envSetupBlock: string;
  importsBlock: string;
  name: string;
  pmInstallCmd: string;
  pmStartCmd: string;
  providersHuman: string;
  spectrumConfigBody: string;
  spectrumTsVersion: string;
}

/**
 * Walks templates/base/, applies token substitution to .tmpl files, copies
 * others verbatim, renames _gitignore → .gitignore, env.example → .env.example,
 * and omits env.example.tmpl when emitEnvFile is false.
 */
export async function copyAndTransform(
  sourceDir: string,
  targetDir: string,
  tokens: CopyTokens,
  options: { emitEnvFile: boolean }
): Promise<void> {
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
    recursive: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absSrc = join(entry.parentPath, entry.name);
    const rel = relative(sourceDir, absSrc);

    if (!options.emitEnvFile && rel === "env.example.tmpl") {
      continue;
    }

    let outRel = rel === "_gitignore" ? ".gitignore" : rel;
    if (outRel.endsWith(".tmpl")) {
      outRel = outRel.slice(0, -".tmpl".length);
    }
    if (outRel === "env.example") {
      outRel = ".env.example";
    }

    const absDest = join(targetDir, outRel);
    const content = await readFile(absSrc, "utf8");
    const transformed =
      entry.name.endsWith(".tmpl") || rel === "_gitignore"
        ? substitute(content, tokens as unknown as Record<string, string>)
        : content;
    await mkdir(dirname(absDest), { recursive: true });
    await writeFile(absDest, transformed);
  }
}
