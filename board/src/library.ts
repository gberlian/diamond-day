// Project library (owner, 26 Nov): INSIGHTS (short learned behaviours, permanent), DECISIONS (permanent) and
// DOCUMENTS (living Markdown, exportable to PDF). Insights live in <ray>/insights/YYYY-MM-DD-slug.md:
// a "# Title" line, then one paragraph.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { safeUnder } from "./docs-page.ts";

export type LibraryItem = { title: string; text?: string; date: string; path: string; pdf?: string; bytes?: number; size?: number; mtime?: number };
export type Library = { insights: LibraryItem[]; decisions: LibraryItem[]; documents: LibraryItem[]; notes?: LibraryItem[]; plans?: LibraryItem[]; changes?: LibraryItem[] };

const DATE = /^(\d{4}-\d{2}-\d{2})/;
function read(abs: string) { try { return readFileSync(abs, "utf8"); } catch { return ""; } }
function titleOf(text: string, fallback: string) {
  const h = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return (h || fallback.replace(/\.md$/i, "").replace(DATE, "").replace(/^[-_]+/, "").replace(/[-_]+/g, " ")).slice(0, 160);
}
function firstParagraph(text: string) {
  const body = text.replace(/^---[\s\S]*?---\s*/, "").replace(/^#.*$/gm, "").trim();
  return (body.split(/\r?\n\s*\r?\n/)[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
}
function mdIn(abs: string): string[] {
  try { return readdirSync(abs, { withFileTypes: true }).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name); }
  catch { return []; }
}
function walk(abs: string, rel: string, skip: Set<string>, out: { rel: string; mtime: number }[], depth = 0) {
  if (depth > 4) return;
  let entries; try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") || skip.has(`${rel}/${e.name}`)) continue;
    const childAbs = path.join(abs, e.name), childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(childAbs, childRel, skip, out, depth + 1);
    else if (e.isFile() && /\.md$/i.test(e.name) && !/^README/i.test(e.name)) {
      try { out.push({ rel: childRel, mtime: statSync(childAbs).mtimeMs }); } catch {}
    }
  }
}

/** The prepared PDF of a document or book, ray-relative (owner 26 Nov: the PDF link printed raw Markdown). */
export function builtPdf(base: string, rel: string): string | null {
  const abs = path.join(base, rel), stem = rel.replace(/\.md$/i, "");
  const dirs = /\.md$/i.test(rel) ? [path.dirname(rel), path.dirname(rel) + "/build"] : [rel + "/build", rel];
  const want = path.basename(stem).toLowerCase();
  let best: { rel: string; mtime: number } | null = null;
  for (const d of dirs) {
    try {
      for (const e of readdirSync(path.join(base, d), { withFileTypes: true })) {
        if (!e.isFile() || !/\.pdf$/i.test(e.name)) continue;
        if (/\.md$/i.test(rel) && e.name.replace(/\.pdf$/i, "").toLowerCase() !== want) continue;
        const candidate = path.posix.join(d, e.name);
        const safe = safeUnder(base, candidate); if (!safe) continue;
        const m = statSync(safe).mtimeMs;
        if (!best || m > best.mtime) best = { rel: candidate, mtime: m };
      }
    } catch {}
  }
  void abs; return best?.rel ?? null;
}
function sizeOf(abs: string): number {
  try { const st = statSync(abs); if (st.isFile()) return st.size;
    let n = 0; for (const e of readdirSync(abs, { withFileTypes: true, recursive: true } as any) as any[])
      if (e.isFile?.() && /\.md$/i.test(e.name)) try { n += statSync(path.join(e.parentPath ?? e.path, e.name)).size; } catch {}
    return n; } catch { return 0; }
}
export function projectLibrary(root: string, ray: string): Library {
  const base = safeUnder(root, ray);
  if (!base || !/^[A-Za-z0-9][\w.-]*$/.test(ray)) return { insights: [], decisions: [], documents: [] };
  const dated = (folder: string, withText: boolean): LibraryItem[] =>
    mdIn(path.join(base, folder)).sort().reverse().map((name) => {
      const text = read(path.join(base, folder, name));
      return { title: titleOf(text, name), ...(withText ? { text: firstParagraph(text) } : {}),
        date: DATE.exec(name)?.[1] ?? "", path: `${ray}/${folder}/${name}` };
    });
  const docs: { rel: string; mtime: number }[] = [];
  walk(path.join(base, "docs"), "docs", new Set(["docs/changes", "docs/reference", "docs/internal"]), docs);
  // A book's chapters show as one document: its chapters folder.
  const books = new Map<string, number>(), singles: { rel: string; mtime: number }[] = [];
  for (const d of docs) {
    const m = /^(.*\/books\/[^/]+)\//.exec(d.rel);
    if (m) books.set(m[1], Math.max(books.get(m[1]) ?? 0, d.mtime)); else singles.push(d);
  }
  const documents = [
    ...[...books].map(([rel, mtime]) => ({ title: rel.split("/").at(-1)!.replace(/[-_]+/g, " "), rel, mtime })),
    ...singles.map((d) => ({ title: titleOf(read(path.join(base, d.rel)), d.rel.split("/").at(-1)!), rel: d.rel, mtime: d.mtime })),
  ].sort((a, b) => b.mtime - a.mtime)
    .map((d) => {
      const size = sizeOf(path.join(base, d.rel)), pdf = builtPdf(base, d.rel);
      return { title: d.title, date: new Date(d.mtime).toISOString().slice(0, 10), path: `${ray}/${d.rel}`, mtime: d.mtime,
        bytes: size, size, ...(pdf ? { pdf } : {}) };
    });
  // Notes other rays (or the owner) left in plans/: YYYY-MM-DD[-HHMM]-from-<who>-<what>.md, newest first.
  const notes = mdIn(path.join(base, "plans")).filter((n) => /^\d{4}-\d{2}-\d{2}-(?:\d{4}-)?from-/.test(n)).sort().reverse().map((name) => {
    const who = /from-([a-z0-9]+)/.exec(name)?.[1] ?? "";
    return { title: `${who}: ${titleOf(read(path.join(base, "plans", name)), name).replace(/^from [a-z0-9-]+,?\s*/i, "").replace(/^owner,?\s*/i, "").replace(/^\(?(?:\d{1,2} [A-Za-z]{3,9},? )?~?\d{1,2}:\d{2}\)?:?\s*/, "").replace(/^\d{1,2} [A-Za-z]{3,9}:\s*/, "").replace(/^:\s*/, "")}`,
      date: DATE.exec(name)?.[1] ?? "", path: `${ray}/plans/${name}` };
  });
  // Owner 27 Nov: plans, change notes and long chat replies were invisible on the board.
  const plans = mdIn(path.join(base, "plans")).filter((n) => !/-from-/.test(n)).sort().reverse()
    .map((name) => ({ title: titleOf(read(path.join(base, "plans", name)), name), date: DATE.exec(name)?.[1] ?? "", path: `${ray}/plans/${name}` }));
  const changes = [...mdIn(path.join(base, "docs", "changes")).filter((n) => !/-full\.md$/.test(n)).map((n) => ["docs/changes", n, ""]),
    ...mdIn(path.join(base, "docs", "changes", "chat")).map((n) => ["docs/changes/chat", n, "chat · "])]
    .sort((x, y) => y[1]!.localeCompare(x[1]!))
    .map(([dir, name, tag]) => ({ title: tag + titleOf(read(path.join(base, dir!, name!)), name!), date: DATE.exec(name!)?.[1] ?? "", path: `${ray}/${dir}/${name}` }));
  return { insights: dated("insights", true), decisions: dated("decisions", false), documents, notes, plans, changes };
}
