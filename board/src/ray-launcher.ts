/** The only adapter allowed to launch a ray window. Never execute via a shell. */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

export type RayAction = "start" | "stop" | "restart";
export type WindowCommand = {
  kind: "command"; ray: string; action: RayAction; executable: string; args: string[];
  /** The exact old handle acted upon; null when creating a previously stopped ray. */
  hwnd: string | null;
};
export type LaunchResult = { ok: boolean; output?: string; error?: string };
export interface RayLauncher {
  run(command: WindowCommand): Promise<LaunchResult>;
}
/** Reject traversal, symlink escapes and case variants before any window operation. */
export function validateRay(root: string, name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("invalid_ray_name");
  const directory = path.join(root, name);
  try {
    if (!lstatSync(directory).isDirectory() ||
      path.dirname(realpathSync(directory)) !== realpathSync(root))
      throw new Error("invalid_ray_directory");
  } catch { throw new Error("invalid_ray_directory"); }
  return directory;
}
export function windowCommand(root: string, ray: string, action: RayAction, hwnd: string | null,
  scriptsDir = scriptsRoot): WindowCommand {
  validateRay(root, ray);
  if ((action === "stop" || action === "restart") && (!hwnd || !/^[1-9]\d*$/.test(hwnd)))
    throw new Error("missing_window_handle");
  if (action === "stop") return {
    kind: "command", action, ray, hwnd,
    executable: process.env.RAY_BOARD_AUTOHOTKEY_BIN ??
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe"),
    args: [path.join(scriptsDir, "ray-window-close.ahk"), ray, hwnd!, path.join(root, ".windows", `${ray}.hwnd`)],
  };
  return { kind: "command", action, ray, hwnd: action === "restart" ? hwnd : null,
    executable: process.env.RAY_BOARD_PWSH_BIN ?? "pwsh",
    args: ["-NoProfile", "-NonInteractive", "-File", path.join(root, "open-ray.ps1"), ray,
      ...(action === "restart" ? ["-Reopen"] : []), "-Fresh", "-NoGrid"],
  };
}
export class PowerShellRayLauncher implements RayLauncher {
  readonly root: string;
  readonly scriptsDir: string;
  constructor(root: string, scriptsDir = scriptsRoot) {
    this.root = root; this.scriptsDir = scriptsDir;
  }
  async run(command: WindowCommand): Promise<LaunchResult> {
    validateRay(this.root, command.ray);
    if (existsSync(path.join(this.root, command.ray, ".restart-gate.json")))
      return { ok: false, error: "handover_in_progress" };
    // No arbitrary commands can be passed through the adapter.
    const expected = windowCommand(this.root, command.ray, command.action, command.hwnd, this.scriptsDir);
    if (JSON.stringify(command) !== JSON.stringify(expected)) throw new Error("invalid_window_command");
    if (command.action !== "stop") {
      const script = path.join(this.root, "open-ray.ps1");
      // The legacy script selected other windows by title and process timestamps. Refuse it outright.
      if (!existsSync(script) || !readFileSync(script, "utf8").includes("# ray-board-handle-safe-v1"))
        return { ok: false, error: "unsafe_open_ray_script: install scripts/open-ray.ps1 at the rays root" };
      if (!existsSync(path.join(this.root, "ray-window-close.ahk")))
        return { ok: false, error: "missing ray-window-close.ahk alongside open-ray.ps1" };
    } else if (!existsSync(expected.args[0]!)) {
      return { ok: false, error: "missing ray-window-close.ahk in ray-board/scripts" };
    }
    return await new Promise<LaunchResult>((resolve) => {
      const child = spawn(command.executable, command.args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", error = "", finished = false;
      const done = (result: LaunchResult) => {
        if (finished) return;
        finished = true; clearTimeout(timer); resolve(result);
      };
      const capture = (chunk: Buffer, current: string) => (current + chunk.toString("utf8")).slice(-4096);
      child.stdout?.on("data", (chunk: Buffer) => { output = capture(chunk, output); });
      child.stderr?.on("data", (chunk: Buffer) => { error = capture(chunk, error); });
      child.on("error", (e) => done({ ok: false, error: String(e) }));
      child.on("close", (exit) => done(exit === 0
        ? { ok: true, output: output.trim() }
        : { ok: false, error: (error || output || `exit ${exit}`).trim() }));
      const timer = setTimeout(() => { child.kill(); done({ ok: false, error: "window command timed out" }); }, 120_000);
    });
  }
}
export class FakeRayLauncher implements RayLauncher {
  readonly calls: WindowCommand[] = [];
  readonly result: LaunchResult;
  constructor(result: LaunchResult = { ok: true }) { this.result = result; }
  async run(command: WindowCommand): Promise<LaunchResult> {
    this.calls.push(structuredClone(command));
    return this.result;
  }
}
