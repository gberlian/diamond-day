#!/usr/bin/env bun
/** The Stop hook can append these lines to its wake message without interpreting GOALS.md. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EDIT_LOG = ".board-edits.jsonl";
export type OwnerEdit = { ts: number; id: string; key: "result" | "purpose"; old: string; new: string } |
  { ts: number; scope: "header"; key: "vision" | "purpose"; old: string; new: string };

// Keep each record on exactly one plain-text line, even if an old field had continuations.
const quote = (s: string) => "'" + JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")
  .replace(/[\u0085\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "'";

/** File order is edit order; the cutoff is inclusive so a same-millisecond edit is not lost. */
export function editsSummary(rayDir: string, since: number): string[] {
  if (!Number.isSafeInteger(since) || since < 0) throw new Error("--since must be a nonnegative epoch millisecond integer");
  let log: string;
  try { log = readFileSync(join(rayDir, EDIT_LOG), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const out: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { continue; } // tolerate incomplete/malformed JSONL rows
    if (!record || typeof record !== "object") continue;
    // Accept timestamp/field aliases for logs from other board versions as well.
    const rawTime = record.ts ?? record.at ?? record.timestamp;
    const ts = typeof rawTime === "number" ? rawTime : typeof rawTime === "string" ?
      (/^\d+$/.test(rawTime) ? Number(rawTime) : Date.parse(rawTime)) : NaN;
    const key = record.key ?? record.field;
    const id = String(record.id ?? record.resultId ?? record.result ?? "");
    const old = record.old ?? record.before, next = record.new ?? record.after;
    if (!Number.isSafeInteger(ts) || ts < since || typeof old !== "string" || typeof next !== "string" || old === next) continue;
    let label: string;
    if (record.scope === "header" && (key === "vision" || key === "purpose")) label = key === "vision" ? "Ultimate Vision" : "Ultimate Purpose";
    else if (/^\d+$/.test(id) && (key === "result" || key === "purpose")) label = `${key === "result" ? "Result" : "Purpose"} #${id}`;
    else continue;
    out.push(`${label} changed: ${quote(old)} -> ${quote(next)}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, flag, cutoff, ...rest] = process.argv.slice(2);
  try {
    if (!dir || flag !== "--since" || !cutoff || !/^\d+$/.test(cutoff) || rest.length)
      throw new Error("usage: bun src/edits-summary.ts <rayDir> --since <ms>");
    const lines = editsSummary(dir, Number(cutoff));
    if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  } catch (e) {
    process.stderr.write((e as Error).message + "\n");
    process.exitCode = 1;
  }
}
