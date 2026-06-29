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
  test("already authed → creates project and reads secret", async () => {
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
    // The secret is read, never rotated — `regenerate-secret` would break any
    // live integration using the existing secret.
    expect(calls).toContainEqual([
      "projects",
      "secret",
      "--project",
      "proj_123",
      "--json",
    ]);
    expect(calls.some((c) => c.includes("regenerate-secret"))).toBe(false);
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

  test("project create fails → null, no secret read", async () => {
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
    // create attempted once; the secret read never reached.
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

  test("existing projectId → skips create, rotates secret for that id", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      // Only the regenerate-secret call lands on `projects` now — no create.
      projects: [{ code: 0, stdout: '{"projectSecret":"spk_live_existing"}' }],
    });

    const creds = await provisionSpectrumProject(
      { name: "app", platforms: ["imessage"], projectId: "proj_existing" },
      { runner, logger: silent }
    );

    expect(creds).toEqual({
      projectId: "proj_existing",
      projectSecret: "spk_live_existing",
    });
    // Never created a project — the supplied id is used as-is.
    expect(calls.some((c) => c[0] === "projects" && c[1] === "create")).toBe(
      false
    );
    // regenerate-secret targeted the supplied id.
    expect(calls).toContainEqual([
      "projects",
      "regenerate-secret",
      "-y",
      "--project",
      "proj_existing",
      "--json",
    ]);
  });

  test("existing projectId but secret mint fails → null, no create", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [{ code: 1, stdout: "" }],
    });

    expect(
      await provisionSpectrumProject(
        { name: "app", platforms: ["imessage"], projectId: "proj_bad" },
        { runner, logger: silent }
      )
    ).toBeNull();
    expect(calls.some((c) => c[0] === "projects" && c[1] === "create")).toBe(
      false
    );
  });

  test("existing projectId, rotateSecret false → pins id, leaves secret blank", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
    });

    const creds = await provisionSpectrumProject(
      {
        name: "app",
        platforms: ["imessage"],
        projectId: "proj_keep",
        rotateSecret: false,
      },
      { runner, logger: silent }
    );

    // Project id is pinned for .env; secret left blank for the user to fill.
    expect(creds).toEqual({ projectId: "proj_keep", projectSecret: "" });
    // The existing secret stays valid — no regenerate-secret (or any
    // `projects`) call is issued.
    expect(calls.some((c) => c[0] === "projects")).toBe(false);
  });

  test("existing projectId, rotateSecret true → rotates the secret", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [{ code: 0, stdout: '{"projectSecret":"spk_live_rot"}' }],
    });

    const creds = await provisionSpectrumProject(
      {
        name: "app",
        platforms: ["imessage"],
        projectId: "proj_rot",
        rotateSecret: true,
      },
      { runner, logger: silent }
    );

    expect(creds).toEqual({
      projectId: "proj_rot",
      projectSecret: "spk_live_rot",
    });
    expect(calls).toContainEqual([
      "projects",
      "regenerate-secret",
      "-y",
      "--project",
      "proj_rot",
      "--json",
    ]);
  });

  test("new project ignores rotateSecret false — still reads its secret", async () => {
    const { runner, calls } = fakeRunner({
      whoami: [{ code: 0, stdout: "{}" }],
      projects: [
        { code: 0, stdout: '{"id":"proj_new"}' },
        { code: 0, stdout: '{"projectSecret":"spk_live_new"}' },
      ],
    });

    const creds = await provisionSpectrumProject(
      { name: "app", platforms: ["imessage"], rotateSecret: false },
      { runner, logger: silent }
    );

    expect(creds).toEqual({
      projectId: "proj_new",
      projectSecret: "spk_live_new",
    });
    // rotateSecret only governs existing projects; a created one still
    // provisions a secret — by reading it, never rotating.
    expect(calls.some((c) => c[0] === "projects" && c[1] === "create")).toBe(
      true
    );
    expect(calls.some((c) => c[0] === "projects" && c[1] === "secret")).toBe(
      true
    );
    expect(
      calls.some((c) => c[0] === "projects" && c[1] === "regenerate-secret")
    ).toBe(false);
  });

  test("secret read returns no secret → null", async () => {
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
