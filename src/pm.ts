export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export function isPm(value: unknown): value is PackageManager {
  return (
    value === "bun" || value === "npm" || value === "pnpm" || value === "yarn"
  );
}

export function detectPm(): PackageManager | null {
  const ua = process.env.npm_config_user_agent;
  if (!ua) {
    return null;
  }
  const first = ua.split(" ")[0];
  if (!first) {
    return null;
  }
  const name = first.split("/")[0];
  return isPm(name) ? name : null;
}

export function installCmd(pm: PackageManager): string {
  return pm === "yarn" ? "yarn" : `${pm} install`;
}

export function runScriptCmd(pm: PackageManager, script: string): string {
  if (pm === "npm") {
    return `npm run ${script}`;
  }
  return `${pm} ${script}`;
}
