import { describe, expect, test } from "bun:test";
import {
  type CliRunner,
  cloudPlatformsFor,
  provisionSpectrumProject,
} from "~/spectrum-cloud.ts";
import { silentLogger } from "../helpers/logger.ts";

/** Records every invocation and replies from a per-subcommand script. */
function fakeRunner(
  replies: Record<string, { code: number; stdout?: string }[]>
): { runner: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const cursors: Record<string, number> = {};
  const runner: CliRunner = (args) => {
    calls.push([...args]);
    const key = args[0] ?? "";
    const queue = replies[key] ?? [{ code: 0, stdout: "" }];
    const i = Math.min(cursors[key] ?? 0, queue.length - 1);
    cursors[key] = (cursors[key] ?? 0) + 1;
    const reply = queue[i] ?? { code: 0 };
    return Promise.resolve({ code: reply.code, stdout: reply.stdout ?? "" });
  };
  return { runner, calls };
}

const silent = silentLogger();

describe("provisionSpectrumProject", () => {
  test("already authed → creates project and mints secret", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: '{"email":"a@b.c"}' }],
      projects: [
        { code: 0, stdout: '{"id":"proj_123"}' },
        { code: 0, stdout: '{"projectSecret":"spk_live_xyz"}' },
      ],
    });

    const creds = await provisionSpectrumProject(
      { name: "my-app", platforms: ["imessage"] },
      { runner, logger: silent }
    );

    expect(creds).toEqual({
      projectId: "proj_123",
      projectSecret: "spk_live_xyz",
    });
    // No login when already authed.
    expect(calls.some((c) => c[0] === "login")).toBe(false);
    // Project created with the given platform and name.
    expect(calls).toContainEqual([
      "projects",
      "create",
      "--name",
      "my-app",
      "--platforms",
      "imessage",
      "--json",
    ]);
  });

  test("multiple platforms → comma-joined --platforms", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [
        { code: 0, stdout: '{"id":"proj_m"}' },
        { code: 0, stdout: '{"projectSecret":"spk_live_m"}' },
      ],
    });

    await provisionSpectrumProject(
      { name: "app", platforms: ["imessage", "whatsapp_business"] },
      { runner, logger: silent }
    );

    expect(calls).toContainEqual([
      "projects",
      "create",
      "--name",
      "app",
      "--platforms",
      "imessage,whatsapp_business",
      "--json",
    ]);
  });

  test("no platforms → omits --platforms, still provisions", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [
        { code: 0, stdout: '{"id":"proj_t"}' },
        { code: 0, stdout: '{"projectSecret":"spk_live_t"}' },
      ],
    });

    const creds = await provisionSpectrumProject(
      { name: "app", platforms: [] },
      { runner, logger: silent }
    );

    expect(creds).toEqual({ projectId: "proj_t", projectSecret: "spk_live_t" });
    // create issued without a --platforms flag.
    expect(calls).toContainEqual([
      "projects",
      "create",
      "--name",
      "app",
      "--json",
    ]);
    expect(calls.some((c) => c.includes("--platforms"))).toBe(false);
  });

  test("not authed → logs in, then succeeds", async () => {
    const { runner, calls } = fakeRunner({
      // First whoami fails, second (post-login) succeeds.
      whoami: [{ code: 1 }, { code: 0, stdout: "{}" }],
      login: [{ code: 0 }],
      projects: [
        { code: 0, stdout: '{"id":"proj_9"}' },
        { code: 0, stdout: '{"projectSecret":"spk_live_9"}' },
      ],
    });

    const creds = await provisionSpectrumProject(
      { name: "app", platforms: ["imessage"] },
      { runner, logger: silent }
    );

    expect(creds).toEqual({ projectId: "proj_9", projectSecret: "spk_live_9" });
    expect(calls.some((c) => c[0] === "login")).toBe(true);
  });

  test("login never completes → null", async () => {
    const { runner } = fakeRunner({
      whoami: [{ code: 1 }],
      login: [{ code: 0 }],
    });
    expect(
      await provisionSpectrumProject(
        { name: "app", platforms: ["imessage"] },
        { runner, logger: silent }
      )
    ).toBeNull();
  });

  test("project create fails → null, no secret rotation", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [{ code: 1, stdout: "" }],
    });
    expect(
      await provisionSpectrumProject(
        { name: "app", platforms: ["imessage"] },
        { runner, logger: silent }
      )
    ).toBeNull();
    // create attempted once; regenerate-secret never reached.
    expect(calls.filter((c) => c[0] === "projects")).toHaveLength(1);
  });

  test("malformed create JSON → null", async () => {
    const { runner } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [{ code: 0, stdout: "not json" }],
    });
    expect(
      await provisionSpectrumProject(
        { name: "app", platforms: ["imessage"] },
        { runner, logger: silent }
      )
    ).toBeNull();
  });

  test("secret rotation returns no secret → null", async () => {
    const { runner } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [
        { code: 0, stdout: '{"id":"proj_1"}' },
        { code: 0, stdout: "{}" },
      ],
    });
    expect(
      await provisionSpectrumProject(
        { name: "app", platforms: ["imessage"] },
        { runner, logger: silent }
      )
    ).toBeNull();
  });
});

describe("cloudPlatformsFor", () => {
  test("always includes imessage — it's mandatory for any cloud project", () => {
    // No selection still provisions iMessage.
    expect(cloudPlatformsFor([])).toEqual(["imessage"]);
    // A non-iMessage selection gets iMessage prepended.
    expect(cloudPlatformsFor(["telegram"])).toEqual(["imessage", "telegram"]);
  });

  test("normalizes dashes to underscores", () => {
    expect(cloudPlatformsFor(["whatsapp-business"])).toEqual([
      "imessage",
      "whatsapp_business",
    ]);
    expect(cloudPlatformsFor(["imessage", "whatsapp-business"])).toEqual([
      "imessage",
      "whatsapp_business",
    ]);
  });

  test("passes provider keys through unchanged when they have no dashes", () => {
    expect(cloudPlatformsFor(["slack", "telegram"])).toEqual([
      "imessage",
      "slack",
      "telegram",
    ]);
  });

  test("dedupes the mandatory imessage when the user also selected it", () => {
    expect(cloudPlatformsFor(["imessage"])).toEqual(["imessage"]);
    expect(cloudPlatformsFor(["imessage", "imessage"])).toEqual(["imessage"]);
  });
});
