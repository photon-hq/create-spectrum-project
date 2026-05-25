import { describe, expect, test } from "bun:test";
import { assembleProviders, substitute } from "~/templates.ts";

const UNKNOWN_TOKEN_RE = /Unknown template token: \{\{missing\}\}/;

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
  const r = assembleProviders(["terminal"]);

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
    expect(r.providerEnvVars).toEqual([]);
    expect(r.needsEnvFile).toBe(false);
  });

  test("human label is `terminal`", () => {
    expect(r.providersHuman).toBe("terminal");
  });
});

describe("assembleProviders — imessage", () => {
  const r = assembleProviders(["imessage"]);

  test("imports iMessage", () => {
    expect(r.importsBlock).toContain('from "spectrum-ts/providers/imessage"');
  });

  test("top-level env vars are PROJECT_ID and PROJECT_SECRET", () => {
    expect(r.topLevelEnvVars).toEqual(["PROJECT_ID", "PROJECT_SECRET"]);
    expect(r.providerEnvVars).toEqual([]);
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

describe("assembleProviders — whatsapp only", () => {
  const r = assembleProviders(["whatsapp"]);

  test("imports whatsappBusiness from whatsapp-business path", () => {
    expect(r.importsBlock).toContain(
      'import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";'
    );
  });

  test("config call wires the three env vars", () => {
    expect(r.spectrumConfigBody).toContain(
      "accessToken: process.env.WA_TOKEN!"
    );
    expect(r.spectrumConfigBody).toContain(
      "phoneNumberId: process.env.WA_NUMBER_ID!"
    );
    expect(r.spectrumConfigBody).toContain("appSecret: process.env.WA_SECRET!");
  });

  test("no top-level Spectrum env vars (WhatsApp owns its own creds)", () => {
    expect(r.topLevelEnvVars).toEqual([]);
  });

  test("provider env vars are WA_TOKEN / WA_NUMBER_ID / WA_SECRET", () => {
    expect(r.providerEnvVars).toEqual([
      "WA_TOKEN",
      "WA_NUMBER_ID",
      "WA_SECRET",
    ]);
  });

  test("needsEnvFile is true", () => {
    expect(r.needsEnvFile).toBe(true);
  });

  test("config body has no projectId or projectSecret", () => {
    expect(r.spectrumConfigBody).not.toContain("projectId");
    expect(r.spectrumConfigBody).not.toContain("projectSecret");
  });
});

describe("assembleProviders — iMessage + WhatsApp", () => {
  const r = assembleProviders(["imessage", "whatsapp"]);

  test("imports both providers", () => {
    expect(r.importsBlock).toContain("providers/imessage");
    expect(r.importsBlock).toContain("providers/whatsapp-business");
  });

  test("emission order is iMessage before WhatsApp regardless of input order", () => {
    const reversed = assembleProviders(["whatsapp", "imessage"]);
    expect(reversed.importsBlock).toBe(r.importsBlock);
    expect(reversed.spectrumConfigBody).toBe(r.spectrumConfigBody);
  });

  test("env file contains both top-level and provider vars", () => {
    expect(r.topLevelEnvVars).toEqual(["PROJECT_ID", "PROJECT_SECRET"]);
    expect(r.providerEnvVars).toEqual([
      "WA_TOKEN",
      "WA_NUMBER_ID",
      "WA_SECRET",
    ]);
  });

  test("config body has both projectId and the whatsapp credential wiring", () => {
    expect(r.spectrumConfigBody).toContain(
      "projectId: process.env.PROJECT_ID!"
    );
    expect(r.spectrumConfigBody).toContain(
      "accessToken: process.env.WA_TOKEN!"
    );
  });
});

describe("assembleProviders — empty input rejected", () => {
  test("throws on empty providers list", () => {
    expect(() => assembleProviders([])).toThrow();
  });
});
