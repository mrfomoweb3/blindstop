/** Structured JSON logs. Callers pass ids, counts and hashes only — never ciphertext or report bodies. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

let threshold: number = LEVELS.info;

export function setLogLevel(l: Level) {
  threshold = LEVELS[l];
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}
