// Project library (owner, 26 Nov): INSIGHTS (short learned behaviours, permanent), DECISIONS (permanent) and
// DOCUMENTS (living Markdown, exportable to PDF). Insights live in <ray>/insights/YYYY-MM-DD-slug.md:
// a "# Title" line, then one paragraph.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { safeUnder } from "./docs-page.ts";

export type LibraryItem = { title: string; text?: string; date: string; path: string };
export type Library = { insights: LibraryItem[]; decisions: LibraryItem[]; documents: LibraryItem[] };

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

export function projectLibrary(root: string, ray: string): Library {
  const base = safeUnder(root, ray);
  if (!base || !/^[A-Za-z0-9][\w.-]*$/.test(ray)) return { insights: [], decisions: [], documents: [] };
  const dated = (folder: string, withText: boolean): LibraryItem[] =>
    mdIn(safeUnder(base, folder) ?? "").sort().reverse().flatMap((name) => {
      const abs = safeUnder(base, `${folder}/${name}`); if (!abs) return [];
      const text = read(abs);
      return [{ title: titleOf(text, name), ...(withText ? { text: firstParagraph(text) } : {}),
        date: DATE.exec(name)?.[1] ?? "", path: `${ray}/${folder}/${name}` }];
    });
  const docs: { rel: string; mtime: number }[] = [];
  walk(safeUnder(base, "docs") ?? "", "docs", new Set(["docs/changes", "docs/reference", "docs/internal"]), docs);
  // A book's chapters show as one document: its chapters folder.
  const books = new Map<string, number>(), singles: { rel: string; mtime: number }[] = [];
  for (const d of docs) {
    const m = /^(.*\/books\/[^/]+)\//.exec(d.rel);
    if (m) books.set(m[1], Math.max(books.get(m[1]) ?? 0, d.mtime)); else singles.push(d);
  }
  const documents = [
    ...[...books].map(([rel, mtime]) => ({ title: rel.split("/").at(-1)!.replace(/[-_]+/g, " "), rel, mtime })),
    ...singles.map((d) => ({ title: titleOf(read(path.join(base, d.rel)), d.rel.split("/").at(-1)!), rel: d.rel, mtime: d.mtime })),
  ].sort((a, b) => b.mtime - a.mtime).slice(0, 40)
    .map((d) => ({ title: d.title, date: new Date(d.mtime).toISOString().slice(0, 10), path: `${ray}/${d.rel}` }));
  return { insights: dated("insights", true), decisions: dated("decisions", false), documents };
}
