/** Two-stage, handle-scoped ray controls. Never mutate on preview. */
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { BoardConfig } from "./config.ts";
import { transcriptFile } from "./sources/transcripts.ts";
import {
  PowerShellRayLauncher, validateRay, windowCommand,
  type RayAction, type RayLauncher, type WindowCommand,
} from "./ray-launcher.ts";
import { reserveWindowAction, windowWait, lastWindowAction } from "./window-spacing.ts";

type FileStep = {
  kind: "rays.txt"; path: string; tempPath: string; change: "add" | "remove" | "none";
  before: string; after: string; atomic: true;
};
export type RayStep = WindowCommand | FileStep;
export type RayPlan = {
  ray: string; action: RayAction; dryRun: boolean; force: boolean;
  steps: RayStep[]; planId: string; hwnd: string | null;
  blocked: string | null; cooldownSeconds: number; lastWindowAction: ReturnType<typeof lastWindowAction>;
};
export type RayObservation = { sessionId: string | null; status: string | null; midToolCall: boolean; detail?: string };
export type RayControlOptions = {
  launcher?: RayLauncher; clock?: () => number; restartsDir?: string;
  inspect?: (ray: string) => RayObservation | Promise<RayObservation>;
};
export const controlLogDir = () => process.env.RAY_RESTARTS_DIR ?? path.join(homedir(), ".ray-restarts");
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

function toolInFlight(file: string): boolean {
  // A tool_use without its matching tool_result remains running even when the transcript is old.
  const data = readFileSync(file, "utf8").slice(-2 * 1024 * 1024);
  const pending = new Set<string>();
  for (const line of data.split(/\r?\n/)) {
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    for (const item of content) {
      if (item?.type === "tool_use" && typeof item.id === "string") pending.add(item.id);
      if (item?.type === "tool_result" && typeof item.tool_use_id === "string") pending.delete(item.tool_use_id);
    }
  }
  return pending.size > 0;
}
/** Conservative check: live registry status and unresolved transcript tool uses. */
export function observeRay(config: BoardConfig, ray: string): RayObservation {
  const folder = process.env.CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
  const want = path.resolve(config.raysRoot, ray).toLowerCase();
  let live: { sessionId: string; status: string; updatedAt: number } | null = null;
  try {
    for (const file of readdirSync(folder)) {
      if (!file.endsWith(".json")) continue;
      try {
        const item = JSON.parse(readFileSync(path.join(folder, file), "utf8"));
        if (String(item.cwd ?? "").toLowerCase() !== want || item.kind !== "interactive" ||
          !Number.isSafeInteger(item.pid) || item.pid <= 0) continue;
        try { process.kill(item.pid, 0); } catch (e: any) { if (e?.code !== "EPERM") continue; }
        if (!live || (item.updatedAt ?? 0) > live.updatedAt)
          live = { sessionId: String(item.sessionId ?? ""), status: String(item.status ?? ""),
            updatedAt: item.updatedAt ?? 0 };
      } catch {}
    }
  } catch {}
  const transcript = transcriptFile(config, ray);
  if (!live) return { sessionId: null, status: null, midToolCall: false };
  if (!transcript || !live.sessionId || transcript.session !== live.sessionId)
    return { sessionId: live.sessionId, status: live.status, midToolCall: true,
      detail: "live session has no matching transcript" };
  try {
    const inFlight = toolInFlight(transcript.file) || live.status !== "idle";
    return { sessionId: live.sessionId, status: live.status, midToolCall: inFlight,
      detail: inFlight ? "live session is not idle or has an unmatched tool_use" : undefined };
  } catch {
    return { sessionId: live.sessionId, status: live.status, midToolCall: true, detail: "transcript unreadable" };
  }
}
/** Preserve every untouched byte, including comments, whitespace and ordering. */
export function editRaysText(before: string, ray: string, action: RayAction): { change: FileStep["change"]; after: string } {
  if (action === "restart") return { change: "none", after: before };
  const lines = before.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const matches = lines.filter((line) => line.replace(/\r?\n$|\r$/, "").trim() === ray);
  if (action === "start") {
    if (matches.length) throw new Error("ray_already_running");
    const nl = before.includes("\r\n") ? "\r\n" : "\n";
    return { change: "add", after: before + (before && !/[\r\n]$/.test(before) ? nl : "") + ray + nl };
  }
  if (!matches.length) throw new Error("ray_not_running");
  return { change: "remove", after: lines.filter((line) => line.replace(/\r?\n$|\r$/, "").trim() !== ray).join("") };
}
function readHandle(root: string, ray: string): string | null {
  const file = path.join(root, ".windows", `${ray}.hwnd`);
  try {
    const value = readFileSync(file, "utf8").trim();
    return /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt("9223372036854775807") ? value : null;
  } catch { return null; }
}
type Owner = { pid: number; at: number; ray: string; action: string; source: string; token?: string };
function lock(folder: string, ray: string, action: RayAction):
  | { release: () => void; holder?: never }
  | { release?: never; holder: Owner | { source: string } } {
  mkdirSync(folder, { recursive: true });
  const dir = path.join(folder, "pass.lock");
  const owner: Owner = { pid: process.pid, at: Date.now(), ray, action, source: "board", token: randomUUID() };
  const create = () => {
    mkdirSync(dir);
    writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner));
    return { release: () => {
      try {
        const current = JSON.parse(readFileSync(path.join(dir, "owner.json"), "utf8"));
        if (current.token === owner.token) rmSync(dir, { recursive: true, force: true });
      } catch {}
    } };
  };
  try { return create(); } catch (e: any) { if (e?.code !== "EEXIST") throw e; }
  let holder: Owner | { source: string } = { source: "unknown" };
  try { holder = JSON.parse(readFileSync(path.join(dir, "owner.json"), "utf8")); } catch {}
  // Match the restarter's stale-lock recovery, but never remove a live owner's lock.
  if ("pid" in holder && Number.isInteger(holder.pid) && Date.now() - holder.at > 10_000) {
    let alive = false;
    try { process.kill(holder.pid, 0); alive = true; } catch (e: any) { alive = e?.code === "EPERM"; }
    if (!alive) {
      try { rmSync(dir, { recursive: true }); return create(); } catch {}
    }
  }
  return { holder };
}
function atomicWrite(step: FileStep) {
  if (step.change === "none") return;
  // Revalidate immediately before replacing: never overwrite an external edit to rays.txt.
  if (readFileSync(step.path, "utf8") !== step.before) throw new Error("rays_txt_changed_during_action");
  try {
    writeFileSync(step.tempPath, step.after, { flag: "wx" });
    renameSync(step.tempPath, step.path);
  } finally { try { rmSync(step.tempPath, { force: true }); } catch {} }
}
export class RayControls {
  readonly launcher: RayLauncher;
  readonly folder: string;
  readonly clock: () => number;
  readonly inspect: (ray: string) => RayObservation | Promise<RayObservation>;
  readonly config: BoardConfig;
  constructor(config: BoardConfig, options: RayControlOptions = {}) {
    this.config = config;
    this.launcher = options.launcher ?? new PowerShellRayLauncher(config.raysRoot);
    this.folder = options.restartsDir ?? controlLogDir();
    this.clock = options.clock ?? Date.now;
    this.inspect = options.inspect ?? ((ray) => observeRay(config, ray));
  }
  async preview(ray: string, action: RayAction, force = false): Promise<RayPlan> {
    validateRay(this.config.raysRoot, ray);
    if (existsSync(path.join(this.config.raysRoot, ray, ".restart-gate.json"))) throw new Error("handover_in_progress");
    const filepath = path.join(this.config.raysRoot, "rays.txt");
    // A missing rays.txt must not silently fall back to directory discovery.
    const before = readFileSync(filepath, "utf8");
    const { change, after } = editRaysText(before, ray, action) as { change: FileStep["change"]; after: string };
    const observation = await this.inspect(ray);
    if (action === "start" && observation.sessionId) throw new Error("ray_still_has_live_session");
    const hwnd = action === "start" ? null : readHandle(this.config.raysRoot, ray);
    const command = windowCommand(this.config.raysRoot, ray, action, hwnd);
    const fileStep: FileStep = { kind: "rays.txt", path: filepath,
      tempPath: path.join(this.config.raysRoot, "rays.txt.control.tmp"), change, before, after, atomic: true };
    const steps: RayStep[] = [command, fileStep];
    const blocked = action !== "start" && observation.midToolCall && !force ? "mid_tool_call" : null;
    const last = lastWindowAction(this.folder);
    const state = { ray, action, force, steps, observation, blocked };
    const planId = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    return { ray, action, dryRun: true, force, steps, planId, hwnd, blocked,
      cooldownSeconds: Math.ceil(windowWait(this.folder, this.clock()) / 1000), lastWindowAction: last };
  }
  async run(ray: string, action: RayAction, force: boolean, planId: string): Promise<Response> {
    const acquired = lock(this.folder, ray, action);
    if (acquired.holder) return reply({ error: "action_locked", holder: acquired.holder }, 409);
    try {
      const plan = await this.preview(ray, action, force);
      if (!/^[0-9a-f]{64}$/.test(planId) || planId !== plan.planId)
        return reply({ error: "dry_run_changed", current: plan }, 409);
      if (plan.blocked) return reply({ error: plan.blocked, plan }, 409);
      const wait = windowWait(this.folder, this.clock());
      if (wait) return reply({ error: "window_action_cooldown", retryAfterSeconds: Math.ceil(wait / 1000),
        last: lastWindowAction(this.folder) }, 429);
      // The lock is held from comparison through the final disk change. Reserve the window slot
      // BEFORE launching so failures/crashes still enforce spacing.
      const change = plan.steps.find((step) => step.kind === "rays.txt");
      if (change?.kind === "rays.txt" && change.change !== "none" && existsSync(change.tempPath))
        return reply({ error: "stale_rays_txt_temporary_file" }, 409);
      const at = this.clock();
      const waited = reserveWindowAction(this.folder, ray, action, at);
      if (waited) return reply({ error: "window_action_cooldown", retryAfterSeconds: Math.ceil(waited / 1000) }, 429);
      let ok = false, error = "", output = "";
      try {
        for (const step of plan.steps) {
          if (step.kind === "command") {
            const result = await this.launcher.run(step);
            output = result.output ?? "";
            if (!result.ok) throw new Error(result.error || "window_command_failed");
          } else atomicWrite(step);
        }
        ok = true;
      } catch (e) { error = String(e instanceof Error ? e.message : e).slice(0, 1000); }
      const log = { at, ray, action, reason: `board ${action}${force ? " (forced)" : ""}`,
        waited: "manual" as const, ctx: null, idleMin: null, attempted: true, ok, error: error || undefined,
        hwnd: plan.hwnd, steps: plan.steps };
      try {
        mkdirSync(this.folder, { recursive: true });
        appendFileSync(path.join(this.folder, "log.jsonl"), JSON.stringify(log) + "\n");
      } catch (e) { return reply({ error: "action_log_failed", ok, action, ray, details: String(e) }, 500); }
      return reply({ ok, ray, action, steps: plan.steps, output, log }, ok ? 200 : 502);
    } finally { acquired.release?.(); }
  }
}
export async function handleRayControlsApi(request: Request, config: BoardConfig,
  controls: RayControls): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const found = /^\/api\/rays\/([^/]+)\/(start|stop|restart)$/.exec(pathname);
  if (!found) return null;
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site")
    return reply({ error: "cross_origin_forbidden" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return reply({ error: "json_required" }, 415);
  if (!config.actions || process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true")
    return reply({ error: "actions_disabled" }, 403);
  const ray = found[1]!, action = found[2]! as RayAction;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.dryRun !== "boolean" ||
    (body.force !== undefined && typeof body.force !== "boolean"))
    return reply({ error: "dryRun must be boolean, force must be boolean if provided" }, 400);
  try {
    if (body.dryRun) return reply(await controls.preview(ray, action, body.force === true));
    if (typeof body.planId !== "string") return reply({ error: "dry_run_required" }, 428);
    return await controls.run(ray, action, body.force === true, body.planId);
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e);
    const badInput = /^(invalid_ray|ray_already_running|ray_not_running|missing_window_handle|ray_still_has_live_session)/.test(message);
    return reply({ error: badInput ? message : "ray_control_unavailable" }, badInput ? 400 : 503);
  }
}
