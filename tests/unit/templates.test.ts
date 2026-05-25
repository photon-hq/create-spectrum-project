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
  const r = assembleProviders(["terminal"], "cloud");

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

  test("hasImessageLocal is false", () => {
    expect(r.hasImessageLocal).toBe(false);
  });
});

describe("assembleProviders — empty input rejected", () => {
  test("throws on empty providers list", () => {
    expect(() => assembleProviders([], "cloud")).toThrow();
  });
});
