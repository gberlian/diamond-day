import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { demoRoot, type BoardConfig } from "../config.ts";
import type { Cell } from "../board.ts";
import type { Source } from "./types.ts";

const short = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;
const clean = (s: string) => s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
export function activityFromTranscript(jsonl: string): string {
  for (const line of jsonl.split(/\r?\n/).reverse()) {
    if (!line.includes('"assistant"')) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    for (const part of (Array.isArray(event?.message?.content) ? event.message.content : []).slice().reverse()) {
      if (part?.type === "tool_use") {
        const details = part.input ?? {};
        const value = details.description ?? details.prompt ?? details.command ?? details.file_path ?? details.pattern ?? details.url ?? "";
        return short(clean(`${part.name}${value ? ": " + String(value) : ""}`), 140);
      }
      if (part?.type === "text" && String(part.text ?? "").trim()) return short(clean(String(part.text)), 140);
    }
  }
  return "";
}
export function transcriptFile(config: BoardConfig, ray: string, sessionId?: string): { file: string; session: string; mtime: number } | null {
  // Claude Code encodes the absolute project directory, including the ray folder.
  const projectPath = path.join(config.raysRoot, ray);
  const slug = projectPath.replace(/[:\\/]/g, "-");
  const folder = path.join(config.claudeProjectsDir, slug);
  if (!existsSync(folder)) {
    if (config.raysRoot === path.join(demoRoot, "rays")) {
      const fixture = path.join(demoRoot, "transcripts", `${ray}.jsonl`);
      if (existsSync(fixture)) return { file: fixture, session: ray, mtime: statSync(fixture).mtimeMs };
    }
    return null;
  }
  let found: { file: string; session: string; mtime: number } | null = null;
  try {
    for (const entry of readdirSync(folder)) {
      if (!entry.endsWith(".jsonl") || (sessionId && entry !== `${sessionId}.jsonl`)) continue;
      const file = path.join(folder, entry);
      const st = statSync(file);
      if (st.isFile() && (!found || st.mtimeMs > found.mtime))
        found = { file, session: entry.slice(0, -6), mtime: st.mtimeMs };
    }
  } catch {}
  return found;
}
export const transcriptSource: Source<
  { activity: Cell["activity"]; usage: Cell["usage"] }, [string, number]
> = {
  read(config, ray, now) {
    const match = transcriptFile(config, ray);
    if (!match) return null;
    try {
      const tail = readFileSync(match.file, "utf8").slice(-512 * 1024);
      let ctx: number | null = null;
      for (const line of tail.split(/\r?\n/).reverse()) {
        let entry: any;
        try { entry = JSON.parse(line); } catch { continue; }
        const u = entry?.message?.usage ?? entry?.usage;
        if (u && typeof u === "object") {
          ctx = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
            .reduce((sum: number, key: string) => sum + (Number(u[key]) || 0), 0);
          break;
        }
        // Fake transcript fields are also useful to local fixture writers.
        if (Number.isFinite(entry?.contextTokens)) { ctx = entry.contextTokens; break; }
      }
      return {
        activity: { busy: now - match.mtime < 30_000, line: activityFromTranscript(tail), ago: now - match.mtime },
        usage: { since: "", ctx, fivePct: null },
      };
    } catch { return null; }
  },
};
