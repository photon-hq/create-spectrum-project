import { describe, expect, test } from "bun:test";
import { detectPm, installCmd, isPm, runScriptCmd } from "~/pm.ts";

describe("pm", () => {
  describe("detectPm", () => {
    const cases: [string | undefined, ReturnType<typeof detectPm>][] = [
      ["npm/10.5.0 node/v20.0.0 darwin arm64", "npm"],
      ["pnpm/9.0.0 npm/? node/v20.0.0 linux x64", "pnpm"],
      ["yarn/1.22.21 npm/? node/v20.0.0 darwin arm64", "yarn"],
      ["bun/1.2.0", "bun"],
      ["unknownpm/1.0.0", null],
      [undefined, null],
      ["", null],
    ];
    for (const [ua, expected] of cases) {
      test(`user agent ${JSON.stringify(ua)} → ${expected}`, () => {
        const prev = process.env.npm_config_user_agent;
        if (ua === undefined) {
          delete process.env.npm_config_user_agent;
        } else {
          process.env.npm_config_user_agent = ua;
        }
        try {
          expect(detectPm()).toBe(expected);
        } finally {
          if (prev === undefined) {
            delete process.env.npm_config_user_agent;
          } else {
            process.env.npm_config_user_agent = prev;
          }
        }
      });
    }
  });

  describe("isPm", () => {
    const truthy = ["bun", "npm", "pnpm", "yarn"];
    const falsy: unknown[] = ["cargo", "", 42, undefined, null, {}];
    for (const v of truthy) {
      test(`isPm(${JSON.stringify(v)}) → true`, () => {
        expect(isPm(v)).toBe(true);
      });
    }
    for (const v of falsy) {
      test(`isPm(${JSON.stringify(v)}) → false`, () => {
        expect(isPm(v)).toBe(false);
      });
    }
  });

  describe("installCmd / runScriptCmd", () => {
    test("yarn install is just yarn", () => {
      expect(installCmd("yarn")).toBe("yarn");
    });
    test("npm install is `npm install`", () => {
      expect(installCmd("npm")).toBe("npm install");
    });
    test("npm script uses run keyword", () => {
      expect(runScriptCmd("npm", "start")).toBe("npm run start");
    });
    test("bun script is `bun start`", () => {
      expect(runScriptCmd("bun", "start")).toBe("bun start");
    });
  });
});
