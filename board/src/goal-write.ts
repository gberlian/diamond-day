/** Scoped GOALS.md edits: replace only one numbered goal, retaining all other Markdown. */
import { readFileSync, realpathSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { BoardConfig } from "./config.ts";

const FIELDS = ["want", "check", "research", "now", "next"] as const;
const isDemo = () => process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true";
/** Editing is on when board actions are on (not demo), or in the demo with a click fixture root. */
export const editingEnabled = (config: BoardConfig) =>
  (config.actions && !isDemo()) || Boolean(process.env.RAY_BOARD_DEMO && process.env.RAY_BOARD_CLICK_FIXTURE_ROOT);
/** A request that reached the board directly on this machine (the shared proxy forwards GETs only). */
export const loopback = (req: Request) => [[127,0,0,1].join("."), "localhost", "[::1]", "::1"].includes(new URL(req.url).hostname);
/** Shared checks for every file-writing route: same origin, JSON body, editing enabled. */
export function writeGuard(req: Request, config: BoardConfig, requireLoopback = false): Response | null {
  const reply = (error: string, status: number) => Response.json({ error }, { status });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin || req.headers.get("sec-fetch-site") === "cross-site")
    return reply("cross_origin_denied", 403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return reply("json_required", 415);
  if (!config.actions && !(process.env.RAY_BOARD_DEMO && process.env.RAY_BOARD_CLICK_FIXTURE_ROOT))
    return reply("editing disabled", 403);
  if (requireLoopback && !loopback(req)) return reply("local only", 403);
  return null;
}
export async function handleGoalWrite(req: Request, config: BoardConfig): Promise<Response | null> {
  const match = /^\/api\/board\/rays\/([a-zA-Z0-9][\w.-]*)\/goals\/(\d+)$/.exec(new URL(req.url).pathname);
  if (!match) return null;
  const reply = (error: string, status: number) => Response.json({ error }, { status });
  if (req.method !== "POST") return reply("POST required", 405);
  const denied = writeGuard(req, config);
  if (denied) return denied;
  const [ray, id] = [match[1]!, match[2]!];
  let values: Record<string, unknown>;
  try { values = await req.json(); } catch { return reply("invalid JSON", 400); }
  if (!values || typeof values !== "object" || Array.isArray(values) ||
    FIELDS.some(k => typeof values[k] !== "string" || (values[k] as string).length > 4096 ||
      /(^|\n)\s*#{1,3}\s/.test(values[k] as string) || (values[k] as string).includes("\0")))
    return reply("invalid goal fields", 400);
  const file = path.join(config.raysRoot, ray, "GOALS.md");
  let md: string;
  try {
    const root = realpathSync(config.raysRoot), target = realpathSync(file);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || !statSync(target).isFile())
      return reply("unsafe GOALS.md path", 400);
    md = readFileSync(file, "utf8");
  } catch { return reply("GOALS.md missing", 404); }
  const heading = new RegExp(`^##\\s+${id}[.)]\\s+[^\\n]*$`, "m");
  const start = heading.exec(md)?.index;
  if (start == null) return reply("goal not found", 404);
  const end = md.slice(start + 3).search(/^##\s+\d+[.)]\s+/m);
  const stop = end < 0 ? md.length : start + 3 + end;
  let section = md.slice(start, stop);
  for (const key of FIELDS) {
    const label = key[0]!.toUpperCase() + key.slice(1);
    const pattern = new RegExp(`^([ \\t]*[-*+]?[ \\t]*\\*\\*${label}:\\*\\*[ \\t]*)[^\\n]*(?:\\n[ \\t]+[^\\n]*)*`, "mi");
    const existing = pattern.exec(section);
    if (!existing) return reply(`missing ${label} field`, 409);
    const lines = (values[key] as string).replace(/\r/g, "").split("\n");
    const replacement = existing[1] + lines[0] + lines.slice(1).map(x => "\n  " + x).join("");
    section = section.slice(0, existing.index) + replacement + section.slice(existing.index + existing[0].length);
  }
  const updated = md.slice(0, start) + section + md.slice(stop);
  const temp = file + "." + process.pid + ".tmp";
  try { writeFileSync(temp, updated, { flag: "wx" }); renameSync(temp, file); }
  catch { return reply("write failed", 500); }
  finally { rmSync(temp, { force: true }); }
  return Response.json({ ok: true, ray, goal: id });
}
