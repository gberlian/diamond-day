/** Docs on the board (owner, 24 Nov: "where i can see our docs and manifesto and decisions … all we had
 * … very well written especially manifesto"). /board/docs lists, manifesto first, then per ray:
 * books (docs/public/books/<book>: front.md + chapters/*.md as one document), decisions, goal research
 * (docs/goals/<goal>/*.md) and the newest change notes. /board/doc?path=<under the rays root> renders one
 * Markdown file, or a book folder as one document, with md-aio's local Markdown renderer; images and
 * figures come from /board/doc-asset. Read-only; only .md files and images under the rays root. */
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { NOTIFICATION_TAG } from "./decision-notifications.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** Resolve a request path safely under root; null when it escapes or is not allowed. */
export function safeUnder(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || /^[a-z]:|^[\\/]/i.test(rel)) return null;
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.some((p) => p === ".." || p === "" || p.startsWith(".git"))) return null;
  const abs = path.resolve(root, ...parts);
  const base = path.resolve(root) + path.sep;
  if (!abs.startsWith(base)) return null;
  try {
    const actual = realpathSync(abs), realRoot = realpathSync(root);
    const relative = path.relative(realRoot, actual);
    return relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative) ? abs : null;
  } catch { return null; }
}

const mdFiles = (dir: string) => { try { return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")).sort(); } catch { return []; } };
const dirs = (dir: string) => { try { return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || (d.isSymbolicLink() && (() => { try { return statSync(path.join(dir, d.name)).isDirectory(); } catch { return false; } })())).map((d) => d.name).sort(); } catch { return []; } };
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const titleOf = (file: string) => {
  try { const m = /^#\s+(.+)$/m.exec(readFileSync(file, "utf8").slice(0, 4000)); if (m) return m[1]!.replace(/[*_`]/g, "").trim(); } catch {}
  return path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-?(\d{4}-)?/, "").replace(/[-_]/g, " ");
};

type Entry = { rel: string; title: string; at: number };
export type RayDocs = { ray: string; books: Entry[]; decisions: Entry[]; goals: Entry[]; changes: Entry[] };

export function listDocs(root: string, ray: string): RayDocs {
  const dir = path.join(root, ray);
  const rel = (...p: string[]) => [ray, ...p].join("/");
  const books = dirs(path.join(dir, "docs", "public", "books")).map((b) => {
    const bd = path.join(dir, "docs", "public", "books", b);
    const first = ["front.md", "README.md"].map((f) => path.join(bd, f)).find(existsSync) ?? path.join(bd, "chapters", mdFiles(path.join(bd, "chapters"))[0] ?? "");
    return { rel: rel("docs", "public", "books", b), title: existsSync(first) && first.endsWith(".md") ? titleOf(first) : b, at: mtime(bd) };
  });
  const decisions = mdFiles(path.join(dir, "decisions")).map((f) => ({ rel: rel("decisions", f), title: titleOf(path.join(dir, "decisions", f)), at: mtime(path.join(dir, "decisions", f)) }))
    .sort((a, b) => b.rel.localeCompare(a.rel));
  const goals = dirs(path.join(dir, "docs", "goals")).flatMap((g) => mdFiles(path.join(dir, "docs", "goals", g))
    .map((f) => ({ rel: rel("docs", "goals", g, f), title: `${g}: ${titleOf(path.join(dir, "docs", "goals", g, f))}`, at: mtime(path.join(dir, "docs", "goals", g, f)) })))
    .sort((a, b) => b.at - a.at);
  const changes = mdFiles(path.join(dir, "docs", "changes")).map((f) => ({ rel: rel("docs", "changes", f), title: titleOf(path.join(dir, "docs", "changes", f)), at: mtime(path.join(dir, "docs", "changes", f)) }))
    .sort((a, b) => b.rel.localeCompare(a.rel)).slice(0, 15);
  return { ray, books, decisions, goals, changes };
}

export type DocTree = { label: string; path?: string; children?: DocTree[]; mtime?: number; size?: number };
/** Fixed sections; paths are ray-relative to the root and never follow directory symlinks. */
export function projectDocTree(root: string, ray: string): DocTree[] {
  const base = safeUnder(root, ray);
  if (!base || !/^[A-Za-z0-9][\w.-]*$/.test(ray)) return [];
  const rel = (name: string) => `${ray}/${name}`;
  const file = (name: string, label = name.split("/").at(-1)!): DocTree | null => {
    const abs = safeUnder(base, name);
    if (!abs) return null;
    const st = statSync(abs);
    return st.isFile() ? { label, path: rel(name), mtime: st.mtimeMs, size: st.size } : null;
  };
  const walk = (name: string, skip: Set<string> = new Set(), newest = false): DocTree[] => {
    const abs = safeUnder(base, name);
    if (!abs || !statSync(abs).isDirectory()) return [];
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }).filter(e => !e.name.startsWith(".") && !skip.has(e.name)); }
    catch { return []; }
    entries.sort((a,b) => newest ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
    return entries.flatMap((e): DocTree[] => {
      const child = `${name}/${e.name}`;
      if (e.isFile() && /\.md$/i.test(e.name)) { const node = file(child); return node ? [node] : []; }
      if (e.isDirectory()) { const children = walk(child, name === "docs" && e.name === "public" ? new Set(["books"]) : new Set(), newest); return children.length ? [{label:e.name, children}] : []; }
      return [];
    });
  };
  const resumes = mdFiles(path.join(base, "plans")).filter(n => /^\d{4}-\d{2}-\d{2}-resume\.md$/.test(n)).reverse();
  const books: DocTree[] = [];
  for (const folder of ["docs/public/books", "docs/books", "books"]) {
    const abs = safeUnder(base, folder);
    if (!abs || !statSync(abs).isDirectory()) continue;
    let entries;
    try { entries = readdirSync(abs, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)); }
    catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const name = `${folder}/${e.name}`, children = walk(name);
        if (children.length) {
          const leaves = (nodes: DocTree[]): DocTree[] => nodes.flatMap(n => n.children ? leaves(n.children) : [n]);
          const files = leaves(children);
          books.push({label:e.name, path:rel(name), children, mtime: Math.max(...files.map(n => n.mtime ?? 0)), size: files.reduce((sum,n) => sum + (n.size ?? 0), 0)});
        }
      } else if (e.isFile() && /\.md$/i.test(e.name)) { const node = file(`${folder}/${e.name}`); if (node) books.push(node); }
    }
  }
  return [file("README.md","README"), file("GOALS.md","GOALS"),
    resumes.length ? file("plans/" + resumes[0], "Resume · " + resumes[0]) : null,
    {label:"Notes", children:mdFiles(path.join(base, "plans")).filter(n => /^\d{4}-\d{2}-\d{2}-.*from-/.test(n)).sort().reverse()
      .map(n => file("plans/" + n, n.replace(/^(\d{4}-\d{2}-\d{2})-(?:\d{4}-)?from-([a-z0-9]+)-?(.*)\.md$/, (_m, d, who, what) => `${d.slice(5)} · ${who} · ${what.replace(/-/g, " ")}`)))
      .filter((x): x is DocTree => x !== null)},
    {label:"Decisions", children:walk("decisions",new Set(["pending","answered","images"]),true)},
    {label:"Changes", children:walk("docs/changes",new Set(),true)},
    {label:"Docs", children:walk("docs",new Set(["changes","books"]))},
    {label:"Books", children:books}].filter((x): x is DocTree => x !== null);
}
const STYLE = `:root { --ink:#0E1621; --row:#132033; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73; --busy:#F3B64C; --done:#4CC2B4; --hot:#F07A5A; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--ink); color:var(--text); font:400 16px/1.55 "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif; }
nav { display:flex; gap:16px; padding:12px 18px; border-bottom:1px solid var(--rule); background:var(--row); flex-wrap:wrap; } nav a { color:var(--soft); text-decoration:none; } nav a.on { color:var(--text); font-weight:600; }
a { color:var(--done); }`;
const HEAD = (title: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">`;

export function renderDocsIndex(root: string, rays: string[], only: string | null): string {
  const manifesto = path.join(root, "toolset", "docs", "manifesto", "book");
  const chapters = mdFiles(manifesto).map((f) => ({ rel: `toolset/docs/manifesto/book/${f}`, title: titleOf(path.join(manifesto, f)) }));
  const list = (es: Entry[]) => es.map((e) => `<li><a href="/board/doc?path=${encodeURIComponent(e.rel)}">${esc(e.title)}</a></li>`).join("");
  const shown = only ? rays.filter((r) => r === only) : rays;
  const sections = shown.map((r) => listDocs(root, r)).filter((d) => d.books.length + d.decisions.length + d.goals.length + d.changes.length)
    .map((d) => `<section><h2>${esc(d.ray)}</h2>
${d.books.length ? `<h3>Books</h3><ul>${list(d.books)}</ul>` : ""}
${d.goals.length ? `<h3>Goal research</h3><ul>${list(d.goals)}</ul>` : ""}
${d.decisions.length ? `<h3>Decisions</h3><ul>${list(d.decisions)}</ul>` : ""}
${d.changes.length ? `<h3>Newest notes</h3><ul>${list(d.changes)}</ul>` : ""}</section>`).join("");
  return `${HEAD("Docs")}<style>::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2c3446;border-radius:8px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:#3d4862;background-clip:padding-box}*{scrollbar-width:thin;scrollbar-color:#2c3446 transparent}${STYLE}
main { padding:8px 18px 40px; max-width:1100px; } h2 { font-size:21px; margin:22px 0 4px; } h3 { font-size:15px; color:var(--mute); font-weight:500; margin:10px 0 2px; }
ul { margin:0; padding-left:18px; columns: 2 420px; } li { break-inside: avoid; } li a { color:var(--text); text-decoration:none; } li a:hover { color:var(--done); }
.manifesto { margin-top:14px; padding:12px 16px; border:1px solid var(--busy); border-radius:6px; background:var(--row); }
.manifesto h2 { margin-top:0; } .manifesto p { color:var(--soft); margin:2px 0 8px; }</style>
<nav><a href="/board">board</a><a href="/board/jobs">jobs</a><a class="${only ? "" : "on"}" href="/board/docs">all docs</a>${rays.map((r) => `<a class="${only === r ? "on" : ""}" href="/board/docs?ray=${encodeURIComponent(r)}">${esc(r)}</a>`).join("")}</nav>
<main>${chapters.length ? `<section class="manifesto"><h2><a href="/board/doc?path=${encodeURIComponent("toolset/docs/manifesto/book")}" style="color:var(--text);text-decoration:none">Manifesto</a></h2><p>How we work, and how every note should read.</p><ul>${chapters.map((c) => `<li><a href="/board/doc?path=${encodeURIComponent(c.rel)}">${esc(c.title)}</a></li>`).join("")}</ul></section>` : ""}
${sections || "<p>No documents yet.</p>"}</main>${NOTIFICATION_TAG}</html>`;
}

/** One document: a .md file, or a folder rendered as one document (book: front.md, then chapters/*.md; else its *.md). */
export function renderDoc(root: string, rel: string, fragment = false, projectRay?: string): Response {
  const abs = safeUnder(root, rel);
  if (!abs || !existsSync(abs)) return new Response("not found", { status: 404 });
  let parts: { rel: string; text: string }[] = [];
  const st = statSync(abs);
  if (st.isDirectory()) {
    const files = [...["front.md"].filter((f) => existsSync(path.join(abs, f))), ...mdFiles(abs).filter((f) => f !== "front.md" && !/^(README|SOURCES|card)\.md$/i.test(f)),
      ...mdFiles(path.join(abs, "chapters")).map((f) => `chapters/${f}`)];
    if (!files.length && existsSync(path.join(abs, "README.md"))) files.push("README.md");
    parts = files.flatMap((f) => {
      const child = safeUnder(abs, f);
      return child && statSync(child).isFile() && statSync(child).size < 4 * 1024 * 1024
        ? [{ rel: `${rel}/${f}`, text: readFileSync(child, "utf8") }] : [];
    });
  } else if (/\.(md|markdown)$/i.test(abs) && st.size < 4 * 1024 * 1024) {
    parts = [{ rel, text: readFileSync(abs, "utf8") }];
  } else return new Response("only Markdown documents", { status: 400 });
  if (!parts.length) return new Response("empty", { status: 404 });
  const title = /^#\s+(.+)$/m.exec(parts[0]!.text)?.[1]?.replace(/[*_`]/g, "") ?? path.basename(rel);
  const data = JSON.stringify(parts).replace(/</g, "\\u003c");
  const up = rel.split("/")[0]!;
  const content = `<article class="board-document" id="doc"></article>
<script type="application/json" id="doc-data">${data}</script>`;
  if (fragment) return new Response(content, {headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  return new Response(`${HEAD(title)}<style>${STYLE}${DOC_STYLE}@media print { html, body { background:#fff !important; color:#111 !important; } nav, header.top { display:none !important; } .board-document, .board-document p, .board-document li, .board-document strong, a { color:#111 !important; } .board-document code, .board-document pre { background:#eee !important; } }</style>
${projectRay ? `<nav><a href="/board/p/${encodeURIComponent(projectRay)}">${esc(projectRay)}</a></nav>` : `<nav><a href="/board">board</a><a href="/board/docs">all docs</a><a href="/board/docs?ray=${encodeURIComponent(up)}">${esc(up)}</a></nav>`}
${content}
<script type="module">${DOC_RENDER_JS}
renderBoardDocument(document.getElementById("doc"), JSON.parse(document.getElementById("doc-data").textContent), ${JSON.stringify(projectRay ?? null)}).then(() => { const q = new URLSearchParams(location.search); if (q.get("print") || q.get("pdf")) setTimeout(() => print(), 700); });
</script>${projectRay ? "" : NOTIFICATION_TAG}</html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const DOC_STYLE = `.board-document { max-width: 76ch; margin: 0 auto; padding: 24px 20px 80px; font: 400 18px/1.65 "Source Serif 4", Georgia, serif; color: var(--text); }
.board-document h1, .board-document h2, .board-document h3 { font-family: "Barlow Semi Condensed", sans-serif; line-height: 1.25; } .board-document h1 { font-size: 32px; } .board-document h2 { font-size: 24px; margin-top: 36px; }
.board-document p, .board-document li { color: #d5dde7; } .board-document strong { color: var(--text); } .board-document img { max-width: 100%; border-radius: 4px; }
.board-document blockquote { margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--rule); color: var(--soft); }
.board-document code { font-size: 15px; background: var(--row); padding: 1px 4px; border-radius: 3px; } .board-document pre { background: var(--row); padding: 10px; overflow: auto; } .board-document pre code { background: none; }
.board-document table { border-collapse: collapse; font: 15px/1.4 "Barlow Semi Condensed", sans-serif; } .board-document td, .board-document th { border: 1px solid var(--rule); padding: 4px 8px; }
.part + .part { border-top: 1px solid var(--rule); margin-top: 40px; padding-top: 8px; }
.raw { white-space: pre-wrap; }`;
export const DOC_RENDER_JS = `async function renderBoardDocument(doc, parts, ray) {
let md = null;
try { const L = await import("/board/vendor/libs.js"); if (L.MarkdownIt) md = new L.MarkdownIt({ html: false, linkify: true, typographer: true }); } catch {}
const docHref = (p, asset) => ray ? "/api/board/project/" + encodeURIComponent(ray) + (asset ? "/doc-asset?path=" : "/doc?view=1&path=") + encodeURIComponent(p) : (asset ? "/board/doc-asset?path=" : "/board/doc?path=") + encodeURIComponent(p);
const dirOf = (p) => p.split("/").slice(0, -1).join("/");
const join = (base, rel) => { const out = base.split("/"); for (const s of rel.split("/")) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); } return out.join("/"); };
for (const p of parts) {
  const div = document.createElement("div"); div.className = "part";
  if (md) div.innerHTML = md.render(p.text); else { div.className += " raw"; div.textContent = p.text; }
  // Relative images and links resolve inside the rays root.
  for (const img of div.querySelectorAll("img[src]")) { const s = img.getAttribute("src"); if (!/^(https?:|data:|\\/)/.test(s)) img.src = docHref(join(dirOf(p.rel), s), true); }
  for (const a of div.querySelectorAll("a[href]")) { const h = a.getAttribute("href"); if (/\\.md(#.*)?$/i.test(h) && !/^(https?:|\\/)/.test(h)) a.href = docHref(join(dirOf(p.rel), h.replace(/#.*$/, "")), false); }
  doc.appendChild(div);
}
}`;

export function serveDocAsset(root: string, rel: string): Response {
  const abs = safeUnder(root, rel);
  if (!abs || !IMG.test(abs) || !existsSync(abs)) return new Response("not found", { status: 404 });
  const ext = abs.split(".").pop()!.toLowerCase();
  // SVG is served with a sandbox CSP so a script inside it can't run on the board's origin.
  const headers: Record<string, string> = { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "max-age=3600" };
  if (ext === "svg") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(readFileSync(abs), { headers });
}
