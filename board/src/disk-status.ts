// Disk guard status is read as an untrusted, read-only JSON file; no disk-guard
// dependency and no additional HTTP endpoint are needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type DiskStatus = {
  freeBytes: number;
  top: { path: string; growth24h: number | null }[];
};
export function diskSeverity(freeBytes: number): "normal" | "amber" | "red" {
  return freeBytes < 20e9 ? "red" : freeBytes < 50e9 ? "amber" : "normal";
}
export function readDiskStatus(
  file = process.env.DISK_GUARD_STATUS ?? join(homedir(), ".disk-guard", "status.json"),
): DiskStatus | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object") return null;
    const d = value as Record<string, unknown>;
    if (!Number.isFinite(d.freeBytes) || (d.freeBytes as number) < 0 ||
        !Array.isArray(d.top) || d.top.length > 10) return null;
    const source = Array.isArray(d.growers) && d.growers.length > 0 ? d.growers : d.top;
    if (source.length > 10) return null;
    const top: DiskStatus["top"] = [];
    for (const t of source) {
      if (!t || typeof t.path !== "string" || !Number.isFinite(t.bytes) ||
          !(t.growth24h === null || Number.isFinite(t.growth24h))) return null;
      top.push({ path: t.path, growth24h: t.growth24h });
    }
    return { freeBytes: d.freeBytes as number, top };
  } catch { return null; }
}
