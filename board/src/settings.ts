// Where new rays and new repos go. One small file shared by the ray command and the board
// (owner, 27 Nov: "settings to choose where to store new rays and where to create new repos,
// configured when using the cli first time"). Environment variables still win.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Settings = { raysRoot?: string; codeRoot?: string };
export const DEFAULTS = { raysRoot: path.join(homedir(), "rays"), codeRoot: path.join(homedir(), "code") } as const;

export function settingsFile(env = process.env): string {
  return env.RAY_SETTINGS ?? path.join(env.HOME ?? env.USERPROFILE ?? homedir(), ".ray", "settings.json");
}
export function readSettings(env = process.env): Settings | null {
  if (!env.RAY_SETTINGS && !env.HOME && !env.USERPROFILE) return null; // a bare env (tests, fixtures) never reads the user's file
  const file = settingsFile(env);
  if (!existsSync(file)) return null;
  try { const d = JSON.parse(readFileSync(file, "utf8")); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
export function writeSettings(s: Settings, env = process.env): string {
  const file = settingsFile(env);
  for (const v of [s.raysRoot, s.codeRoot]) if (v !== undefined && (typeof v !== "string" || !path.isAbsolute(v))) throw new Error(`not an absolute folder: ${v}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...(readSettings(env) ?? {}), ...s }, null, 2) + "\n", "utf8");
  return file;
}
