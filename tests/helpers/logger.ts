import type { ScaffoldLogger } from "~/scaffold.ts";

export interface CapturingLogger extends ScaffoldLogger {
  steps: string[];
  streamChunks: string[];
  warnings: string[];
}

export function silentLogger(): CapturingLogger {
  const steps: string[] = [];
  const warnings: string[] = [];
  const streamChunks: string[] = [];
  return {
    step: (msg) => {
      steps.push(msg);
    },
    warn: (msg) => {
      warnings.push(msg);
    },
    stream: (chunk) => {
      streamChunks.push(chunk);
    },
    steps,
    warnings,
    streamChunks,
  };
}
