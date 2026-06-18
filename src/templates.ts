import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Manifest, type Provider, TERMINAL_KEY } from "./scaffold.ts";

/** A provider-specific env var, with where to get it for .env / README copy. */
export interface ProviderEnvVar {
  /** Plain-text note for the .env comment, e.g. "Telegram bot token (from @BotFather)". */
  comment: string;
  /** Env var name, e.g. "TELEGRAM_BOT_TOKEN". */
  name: string;
  /** Markdown source for the README env-setup section, e.g. "[@BotFather](https://t.me/BotFather) on Telegram". */
  source: string;
}

export interface ProviderAssembly {
  importsBlock: string;
  needsEnvFile: boolean;
  providerEnv: ProviderEnvVar[];
  providersHuman: string;
  spectrumConfigBody: string;
  topLevelEnvVars: string[];
}

interface ProviderConfig {
  /** Args rendered inside `.config({...})`. Empty → bare `.config()`. */
  configArg: string;
  /** The env var this provider's config reads. */
  env: ProviderEnvVar;
}

/**
 * Provider-specific `.config({...})` args and the env vars they read — detail
 * the spectrum-ts manifest doesn't carry, so it's hardcoded by key here (same
 * precedent as {@link TERMINAL_KEY}). Providers absent from this map emit a
 * bare `.config()` and contribute no provider env vars; their credentials, if
 * any, flow through the top-level Photon project secret.
 */
const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  telegram: {
    configArg: "{ botToken: process.env.TELEGRAM_BOT_TOKEN! }",
    env: {
      name: "TELEGRAM_BOT_TOKEN",
      comment: "Telegram bot token (from @BotFather)",
      source: "[@BotFather](https://t.me/BotFather) on Telegram",
    },
  },
};

export function assembleProviders(
  providers: Provider[],
  manifest: Manifest
): ProviderAssembly {
  if (providers.length === 0) {
    throw new Error("assembleProviders: at least one provider required");
  }

  // Resolve every selected key against the manifest up front. Catches
  // typos and stale CLI args before we start composing code.
  const selected = providers.map((key) => {
    const entry = manifest.find((m) => m.key === key);
    if (!entry) {
      throw new Error(
        `Unknown provider "${key}". Available: ${manifest
          .map((m) => m.key)
          .join(", ")}`
      );
    }
    return entry;
  });

  // A platform = any non-terminal provider. Drives whether the generated
  // `Spectrum({...})` call includes top-level projectId/projectSecret.
  const hasPlatform = selected.some((m) => m.key !== TERMINAL_KEY);

  // Deterministic emission order: terminal first if present, then
  // platform providers in their manifest order (alphabetical by key,
  // since spectrum-ts's generator sorts that way).
  const ordered = [
    ...selected.filter((m) => m.key === TERMINAL_KEY),
    ...manifest
      .filter((m) => m.key !== TERMINAL_KEY)
      .filter((m) => selected.some((s) => s.key === m.key)),
  ];

  const imports = ['import { Spectrum } from "spectrum-ts";'];
  const providerLines: string[] = [];
  const humanParts: string[] = [];
  const providerEnv: ProviderEnvVar[] = [];

  for (const meta of ordered) {
    const cfg = PROVIDER_CONFIG[meta.key];
    imports.push(`import { ${meta.import} } from "${meta.path}";`);
    providerLines.push(`    // ${meta.label}`);
    providerLines.push(`    ${meta.import}.config(${cfg?.configArg ?? ""}),`);
    humanParts.push(meta.label);
    if (cfg) {
      providerEnv.push(cfg.env);
    }
  }

  const importsBlock = imports.join("\n");

  const configLines: string[] = [];
  if (hasPlatform) {
    configLines.push("  projectId: process.env.PROJECT_ID!,");
    configLines.push("  projectSecret: process.env.PROJECT_SECRET!,");
  }
  configLines.push("  providers: [");
  configLines.push(...providerLines);
  configLines.push("  ],");

  const topLevelEnvVars = hasPlatform ? ["PROJECT_ID", "PROJECT_SECRET"] : [];

  return {
    importsBlock,
    spectrumConfigBody: configLines.join("\n"),
    topLevelEnvVars,
    providerEnv,
    needsEnvFile: hasPlatform || providerEnv.length > 0,
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
  devScript: string;
  envAgentBlock: string;
  envBlock: string;
  envSetupBlock: string;
  extraDevDeps: string;
  importsBlock: string;
  name: string;
  pmInstallCmd: string;
  pmStartCmd: string;
  providersHuman: string;
  spectrumConfigBody: string;
  spectrumTsVersion: string;
  startScript: string;
  tsTypes: string;
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
