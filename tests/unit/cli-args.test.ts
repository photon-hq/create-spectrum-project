import { describe, expect, test } from "bun:test";
import { collectFlagOptions, parseCliArgs } from "~/bin.ts";
import { FIXTURE_MANIFEST } from "../helpers/manifest.ts";

function optionsFor(argv: string[]) {
  const { values, positionals } = parseCliArgs(argv);
  return collectFlagOptions(values, positionals, FIXTURE_MANIFEST);
}

describe("cli args — platform selection flag", () => {
  test("--providers selects the listed platforms", () => {
    expect(optionsFor(["--providers", "imessage,telegram"]).providers).toEqual([
      "imessage",
      "telegram",
    ]);
  });

  test("--platforms is an alias for --providers", () => {
    expect(optionsFor(["--platforms", "imessage,telegram"]).providers).toEqual([
      "imessage",
      "telegram",
    ]);
  });

  test("--platforms works alongside other flags (the -y regression)", () => {
    const opts = optionsFor([
      "my-app",
      "--platforms",
      "imessage",
      "--pm",
      "npm",
    ]);
    expect(opts.providers).toEqual(["imessage"]);
    expect(opts.targetDir).toBe("my-app");
    expect(opts.packageManager).toBe("npm");
  });

  test("neither flag leaves providers unset (defaults applied later)", () => {
    expect(optionsFor(["my-app"]).providers).toBeUndefined();
  });
});
