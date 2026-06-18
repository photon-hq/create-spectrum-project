import { describe, expect, test } from "bun:test";
import { assembleProviders, substitute } from "~/templates.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";

const UNKNOWN_TOKEN_RE = /Unknown template token: \{\{missing\}\}/;
const UNKNOWN_PROVIDER_RE = /Unknown provider "nonexistent"/;

describe("substitute", () => {
  test("replaces known tokens", () => {
    expect(substitute("hi {{name}}!", { name: "world" })).toBe("hi world!");
  });
  test("throws on unknown token", () => {
    expect(() => substitute("{{missing}}", {})).toThrow(UNKNOWN_TOKEN_RE);
  });
  test("ignores non-token braces", () => {
    expect(substitute("plain { not } a token", {})).toBe(
      "plain { not } a token"
    );
  });
});

describe("assembleProviders — terminal only", () => {
  const r = assembleProviders(["terminal"], FIXTURE_MANIFEST);

  test("imports Spectrum + terminal only", () => {
    expect(r.importsBlock).toBe(
      [
        'import { Spectrum } from "spectrum-ts";',
        'import { terminal } from "spectrum-ts/providers/terminal";',
      ].join("\n")
    );
  });

  test("config body has no projectId or projectSecret", () => {
    expect(r.spectrumConfigBody).not.toContain("projectId");
    expect(r.spectrumConfigBody).not.toContain("projectSecret");
  });

  test("no env vars required", () => {
    expect(r.topLevelEnvVars).toEqual([]);
    expect(r.needsEnvFile).toBe(false);
  });

  test("human label is `Terminal`", () => {
    expect(r.providersHuman).toBe("Terminal");
  });
});

describe("assembleProviders — imessage", () => {
  const r = assembleProviders(["imessage"], FIXTURE_MANIFEST);

  test("imports iMessage", () => {
    expect(r.importsBlock).toContain('from "spectrum-ts/providers/imessage"');
  });

  test("top-level env vars are PROJECT_ID and PROJECT_SECRET", () => {
    expect(r.topLevelEnvVars).toEqual(["PROJECT_ID", "PROJECT_SECRET"]);
  });

  test("config body wires projectId and projectSecret", () => {
    expect(r.spectrumConfigBody).toContain(
      "projectId: process.env.PROJECT_ID!"
    );
    expect(r.spectrumConfigBody).toContain(
      "projectSecret: process.env.PROJECT_SECRET!"
    );
  });

  test("provider config takes no args", () => {
    expect(r.spectrumConfigBody).toContain("imessage.config(),");
    expect(r.spectrumConfigBody).not.toContain("imessage.config({");
  });

  test("needsEnvFile is true", () => {
    expect(r.needsEnvFile).toBe(true);
  });

  test("human label is `iMessage`", () => {
    expect(r.providersHuman).toBe("iMessage");
  });
});

describe("assembleProviders — whatsapp-business only", () => {
  const r = assembleProviders(["whatsapp-business"], FIXTURE_MANIFEST);

  test("imports whatsappBusiness from whatsapp-business path", () => {
    expect(r.importsBlock).toContain(
      'import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";'
    );
  });

  test("config call takes no args (Meta-approved, uses top-level creds)", () => {
    expect(r.spectrumConfigBody).toContain("whatsappBusiness.config(),");
  });

  test("top-level env vars are PROJECT_ID and PROJECT_SECRET", () => {
    expect(r.topLevelEnvVars).toEqual(["PROJECT_ID", "PROJECT_SECRET"]);
  });

  test("needsEnvFile is true", () => {
    expect(r.needsEnvFile).toBe(true);
  });
});

describe("assembleProviders — telegram only", () => {
  const r = assembleProviders(["telegram"], FIXTURE_MANIFEST);

  test("imports telegram from telegram path", () => {
    expect(r.importsBlock).toContain(
      'import { telegram } from "spectrum-ts/providers/telegram";'
    );
  });

  test("config call passes botToken from env", () => {
    expect(r.spectrumConfigBody).toContain(
      "telegram.config({ botToken: process.env.TELEGRAM_BOT_TOKEN! }),"
    );
  });

  test("contributes TELEGRAM_BOT_TOKEN as a provider env var", () => {
    expect(r.providerEnv.map((e) => e.name)).toEqual(["TELEGRAM_BOT_TOKEN"]);
  });

  test("needsEnvFile is true", () => {
    expect(r.needsEnvFile).toBe(true);
  });
});

describe("assembleProviders — imessage + whatsapp-business", () => {
  const r = assembleProviders(
    ["imessage", "whatsapp-business"],
    FIXTURE_MANIFEST
  );

  test("imports both providers", () => {
    expect(r.importsBlock).toContain("providers/imessage");
    expect(r.importsBlock).toContain("providers/whatsapp-business");
  });

  test("emission order is iMessage before WhatsApp regardless of input order", () => {
    const reversed = assembleProviders(
      ["whatsapp-business", "imessage"],
      FIXTURE_MANIFEST
    );
    expect(reversed.importsBlock).toBe(r.importsBlock);
    expect(reversed.spectrumConfigBody).toBe(r.spectrumConfigBody);
  });

  test("env file has only top-level vars (Meta-approved, no inline WA_*)", () => {
    expect(r.topLevelEnvVars).toEqual(["PROJECT_ID", "PROJECT_SECRET"]);
  });

  test("config body has projectId/projectSecret for both providers", () => {
    expect(r.spectrumConfigBody).toContain(
      "projectId: process.env.PROJECT_ID!"
    );
  });
});

describe("assembleProviders — unknown key rejected", () => {
  test("throws when a provider isn't in the manifest", () => {
    expect(() => assembleProviders(["nonexistent"], FIXTURE_MANIFEST)).toThrow(
      UNKNOWN_PROVIDER_RE
    );
  });
});

describe("assembleProviders — empty input rejected", () => {
  test("throws on empty providers list", () => {
    expect(() => assembleProviders([], FIXTURE_MANIFEST)).toThrow();
  });
});
