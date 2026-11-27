// TRACKER.md in the configured rays root is a priority list; its top row is first.
// /board shows the open rows and lets the owner drag them; a drop rewrites only the order of the table rows.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TrackerRow = { id: string; date: string; sent: string; ray: string; owner: string; status: string; latest: string; next: string };

const cells = (line: string) => line.split("|").slice(1, -1).map((x) => x.trim());
const isRow = (line: string) => line.startsWith("|") && /^\d+$/.test(cells(line)[0] ?? "");
const plain = (s: string) => s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

/** Every numbered row of the tracker table, in file order (= priority). */
export function parseTracker(markdown: string): TrackerRow[] {
  return markdown.split(/\r?\n/).filter(isRow).map((line) => {
    const c = cells(line);
    const ray = plain(c[3] ?? "");
    return {
      id: c[0]!, date: c[1] ?? "", sent: plain(c[2] ?? ""), ray,
      // The first ray named owns the row ("solana + toolset" belongs to solana).
      owner: ray.toLowerCase().match(/[a-z][\w-]*/)?.[0] ?? "",
      status: plain(c[4] ?? "").toLowerCase(), latest: plain(c[5] ?? ""), next: plain(c[6] ?? ""),
    };
  });
}

export const isOpen = (r: TrackerRow) => !/^(done|dropped)/.test(r.status);

/**
 * Put the rows named in `ids` first, in that order; every other row keeps its place relative to the others and follows.
 * Only the table's numbered rows move: header, separator, text around the table and the rows' own text stay byte-identical.
 * Rows sit where the table's rows were; blank lines between rows are removed, a table split by any other line is refused.
 */
export function reorderTracker(markdown: string, ids: string[]): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const at = lines.map((l, i) => (isRow(l) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return markdown;
  const span = lines.slice(at[0]!, at.at(-1)! + 1);
  // A stray blank line inside the table (it splits the table when rendered) is closed up; any other line is refused.
  if (span.some((l) => !isRow(l) && l.trim() !== "")) throw new Error("tracker table rows are not contiguous");
  const rows = at.map((i) => lines[i]!);
  const byId = new Map(rows.map((l) => [cells(l)[0]!, l]));
  const wanted = [...new Set(ids.map(String))].filter((id) => byId.has(id));
  const rest = rows.filter((l) => !wanted.includes(cells(l)[0]!));
  lines.splice(at[0]!, span.length, ...wanted.map((id) => byId.get(id)!), ...rest);
  return lines.join(eol);
}

export function trackerFile(root: string) { return path.join(root, "TRACKER.md"); }

export function readTracker(root: string): TrackerRow[] {
  const f = trackerFile(root);
  return existsSync(f) ? parseTracker(readFileSync(f, "utf8")) : [];
}

/** Save a new order. `ids` is the open rows as the owner sees them; closed rows go after them in their old order. */
export function saveTrackerOrder(root: string, ids: string[]): TrackerRow[] {
  const f = trackerFile(root);
  const before = readFileSync(f, "utf8");
  const after = reorderTracker(before, ids);
  if (after !== before) {
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, after);
    renameSync(tmp, f);
  }
  return parseTracker(after);
}

/** Reorder only the rows named in `ids` among the table positions they already hold (a drag inside one ray's cell). */
export function reorderWithin(markdown: string, ids: string[]): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const want = [...new Set(ids.map(String))];
  const slots = lines.map((l, i) => (isRow(l) && want.includes(cells(l)[0]!) ? i : -1)).filter((i) => i >= 0);
  const byId = new Map(slots.map((i) => [cells(lines[i]!)[0]!, lines[i]!]));
  const order = want.filter((id) => byId.has(id));
  if (order.length !== slots.length) return markdown;
  slots.forEach((slot, k) => { lines[slot] = byId.get(order[k]!)!; });
  return lines.join(eol);
}

export function saveWithinOrder(root: string, ids: string[]): TrackerRow[] {
  const f = trackerFile(root);
  const before = readFileSync(f, "utf8");
  const after = reorderWithin(before, ids);
  if (after !== before) { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, after); renameSync(tmp, f); }
  return parseTracker(after);
}

/** Row age lives in process memory: ordinary board reads never modify ray files. */
const rowSeen = new Map<string, Map<string, { h: string; at: number }>>();
export function rowAges(root: string, rows: TrackerRow[], now = Date.now()): Map<string, number> {
  let seen = rowSeen.get(root);
  if (!seen) { seen = new Map(); rowSeen.set(root, seen); }
  const ages = new Map<string, number>();
  for (const r of rows) {
    const h = `${r.status}|${r.latest}|${r.next}`;
    const old = seen.get(r.id);
    if (!old || old.h !== h) seen.set(r.id, { h, at: now });
    ages.set(r.id, now - seen.get(r.id)!.at);
  }
  return ages;
}
