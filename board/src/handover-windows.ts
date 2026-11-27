/** Windows operations keyed by one persisted, never-reused successor UUID. */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRay } from "./ray-launcher.ts";
export type WindowSnapshot = { hwnd: string; rect: [number, number, number, number]; pid: number };
export type WindowAttempt = { successorId: string; oldSession: string; note: string; window: WindowSnapshot };
type Result = { ok: boolean; error?: string };
export interface HandoverWindows {
  capture(ray: string, pid: number): Promise<WindowSnapshot>;
  /** Repeating open with the same UUID must never launch another window. */
  open(ray: string, attempt: WindowAttempt): Promise<Result>;
  verify(ray: string, attempt: WindowAttempt, pid: number): Promise<Result>;
  /** Success means this exact window is absent, even after a previous interrupted close. */
  close(ray: string, attempt: WindowAttempt, target: "old" | "successor", pid?: number): Promise<Result>;
  promote(ray: string, attempt: WindowAttempt, pid: number): Promise<Result>;
}
const helper = fileURLToPath(new URL("../scripts/handover-window.ahk", import.meta.url));
const ahk = () => process.env.RAY_BOARD_AUTOHOTKEY_BIN ?? path.join(process.env.ProgramFiles ?? "C:/Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe");
const hwnd = (file: string) => {
  try { const value = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim(); if (/^[1-9]\d*$/.test(value)) return value; } catch {}
  return "";
};
function run(executable: string, args: string[], timeout = 60_000): Result & { output: string } {
  const r = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout });
  const output = String(r.stdout ?? "").trim();
  return { ok: !r.error && r.status === 0, output, error: r.error || r.status !== 0 ? String(r.error ?? (r.stderr || output || `exit ${r.status}`)).slice(0, 300) : undefined };
}
export function windowsHandover(root: string): HandoverWindows {
  const primary = (ray: string) => path.join(root, ".windows", `${ray}.hwnd`);
  const registered = (ray: string, a: WindowAttempt) => path.join(root, ".windows", `${ray}.successor-${a.successorId}.hwnd`);
  const invoke = (mode: string, ray: string, ...args: string[]) => {
    validateRay(root, ray);
    return run(ahk(), [helper, mode, ray, ...args]);
  };
  return {
    async capture(ray, pid) {
      validateRay(root, ray);
      const script = path.join(root, "open-ray.ps1");
      if (!existsSync(script) || !readFileSync(script, "utf8").includes("# ray-board-handover-v1") ||
          !existsSync(path.join(root, "handover-window.ahk")) ||
          !readFileSync(path.join(root, "ray-claude.ps1"), "utf8").includes("HandoverId"))
        throw new Error("deploy handover-aware opener, launcher and AHK helper before enabling automatic handover");
      const h = hwnd(primary(ray));
      if (!h) throw new Error("missing old exact window handle");
      const r = invoke("capture", ray, h, String(pid));
      const rect = r.output.split(",").map(Number);
      if (!r.ok || rect.length !== 4 || !rect.every(Number.isSafeInteger) || rect[2]! <= 0 || rect[3]! <= 0)
        throw new Error(r.error ?? "invalid restored window rectangle");
      return { hwnd: h, rect: rect as WindowSnapshot["rect"], pid };
    },
    async open(ray, a) {
      validateRay(root, ray);
      // Explicit fresh UUID: never --continue, even if the ray already has a conversation.
      const prompt = `Handover successor for ${ray}. Your session ID is ${a.successorId}. Read CLAUDE.md, README.md, GOALS.md, the shared parent CLAUDE.md and the newest resume note ${a.note} and linked state. Do not edit files or start tasks yet. Run bun C:/Code/ray-board/src/restarter.ts confirm ${ray} ${a.successorId} "${a.note}" "<one-line summary of the first task you will do>". Replace the summary placeholder with your actual plan. Then end your turn and wait for the Stop hook to release you after the old session has closed. If confirmation fails, fix it before doing any work.`;
      return run(process.env.RAY_BOARD_PWSH_BIN ?? "pwsh", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "open-ray.ps1"), ray,
        "-Successor", "-Fresh", "-NoGrid", "-HandoverId", a.successorId, "-Prompt", prompt], 90_000);
    },
    async verify(ray, a, pid) {
      const h = hwnd(registered(ray, a));
      if (!h || h === a.window.hwnd) return { ok: false, error: "missing or invalid successor registration" };
      return invoke("verify", ray, h, String(pid), a.successorId);
    },
    async close(ray, a, target, pid) {
      if (target === "old") {
        // An already-absent HWND is success only when its session is also gone (checked by caller).
        // Original PID is retained for retries; a changed registered PID is not trusted.
        if (pid !== undefined && pid !== a.window.pid) return { ok: false, error: "old session PID changed" };
        return invoke("close", ray, a.window.hwnd, String(a.window.pid), "old", primary(ray));
      }
      let h = hwnd(registered(ray, a));
      if (!h) {
        // Reconcile an interrupted registration under the same named launch mutex. A durable
        // abort tombstone prevents a delayed opener from creating a window after cleanup.
        const abort = invoke("abort", ray, a.successorId, root, registered(ray, a));
        if (!abort.ok) return abort;
        h = hwnd(registered(ray, a));
        if (!h) return pid === undefined ? { ok: true } : { ok: false, error: "successor live but window not registered" };
      }
      if (h === a.window.hwnd) return { ok: false, error: "successor handle equals old handle" };
      return invoke("close", ray, h, String(pid ?? 0), a.successorId, registered(ray, a));
    },
    async promote(ray, a, pid) {
      const h = hwnd(registered(ray, a));
      if (!h || h === a.window.hwnd) return { ok: false, error: "invalid successor handle" };
      const current = hwnd(primary(ray));
      if (current && current !== a.window.hwnd && current !== h) return { ok: false, error: "primary window registration changed" };
      const r = invoke("place", ray, h, String(pid), a.successorId, ...a.window.rect.map(String));
      if (!r.ok) return r;
      const target = primary(ray), temp = `${target}.${a.successorId}.tmp`;
      writeFileSync(temp, h); renameSync(temp, target);
      return { ok: true };
    },
  };
}
