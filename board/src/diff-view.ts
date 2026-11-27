/** Readable diffs for the board (owner, 24 Nov 01:55: "wtf is that diff … unreadable").
 * parseUnifiedDiff turns `git show` / `git diff` output into files and hunks; renderDiffHtml draws
 * one section per file (path, +/- counts), a unified view with green/red line backgrounds and old/new
 * line numbers, collapsed unchanged ranges between hunks, syntax highlighting, and Markdown files
 * rendered as Markdown with added and removed blocks marked (toggle to the raw diff).
 * Highlighting and Markdown use md-aio's local bundle (served at /board/vendor/libs.js); without it the
 * page still renders, just uncoloured. No CDN. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DiffLine = { t: " " | "+" | "-"; s: string; o: number | null; n: number | null };
export type Hunk = { oldStart: number; newStart: number; head: string; lines: DiffLine[] };
export type DiffFile = { path: string; oldPath: string | null; status: "added" | "deleted" | "renamed" | "modified" | "binary";
  adds: number; dels: number; hunks: Hunk[] };

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null, h: Hunk | null = null, o = 0, n = 0;
  const strip = (p: string) => p.replace(/^"|"$/g, "").replace(/^[ab]\//, "");
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git (.+?) (b\/.+|"b\/.+")$/.exec(raw);
      f = { path: m ? strip(m[2]!) : raw.slice(11), oldPath: null, status: "modified", adds: 0, dels: 0, hunks: [] };
      files.push(f); h = null; continue;
    }
    if (!f) continue;
    if (!h) {
      if (raw.startsWith("new file mode")) { f.status = "added"; continue; }
      if (raw.startsWith("deleted file mode")) { f.status = "deleted"; continue; }
      if (raw.startsWith("rename from ")) { f.oldPath = raw.slice(12); f.status = "renamed"; continue; }
      if (raw.startsWith("rename to ")) { f.path = raw.slice(10); continue; }
      if (raw.startsWith("Binary files") || raw.startsWith("GIT binary patch")) { f.status = "binary"; continue; }
      if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
        const p = raw.slice(4);
        if (raw.startsWith("+++ ") && p !== "/dev/null") f.path = strip(p);
        continue;
      }
    }
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hm) { o = +hm[1]!; n = +hm[2]!; h = { oldStart: o, newStart: n, head: hm[3]!.trim(), lines: [] }; f.hunks.push(h); continue; }
    if (!h) continue;
    const c = raw[0];
    if (c === "+") { h.lines.push({ t: "+", s: raw.slice(1), o: null, n: n++ }); f.adds++; }
    else if (c === "-") { h.lines.push({ t: "-", s: raw.slice(1), o: o++, n: null }); f.dels++; }
    else if (c === " " || raw === "") { if (raw === "" && h.lines.length === 0) continue; h.lines.push({ t: " ", s: raw.slice(1), o: o++, n: n++ }); }
    // "\ No newline at end of file" and anything else: skip.
  }
  return files;
}

/** md-aio's vendored MarkdownIt + highlight.js bundle, if installed next to the code root. */
export function renderLibsPath(codeRoot: string): string | null {
  const p = process.env.RAY_BOARD_RENDER_LIBS ?? join(codeRoot, "md-aio", "public", "vendor", "libs.js");
  return existsSync(p) ? p : null;
}
export function serveRenderLibs(codeRoot: string): Response {
  const p = renderLibsPath(codeRoot);
  if (!p) return new Response("// render libraries not installed\nexport {};", { headers: { "content-type": "text/javascript" } });
  return new Response(readFileSync(p), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600" } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function renderDiffHtml(o: { title: string; meta: string[]; message?: string; extraHtml?: string; files: DiffFile[]; note?: string; raw?: string }): string {
  const adds = o.files.reduce((a, f) => a + f.adds, 0), dels = o.files.reduce((a, f) => a + f.dels, 0);
  // JSON inside <script type=application/json>: escape "<" so no tag can close the script early.
  const data = JSON.stringify(o.files).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root { --ink:#0E1621; --row:#132033; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73; --busy:#F3B64C; --done:#4CC2B4; --hot:#F07A5A;
  --add:#123a2f; --addnum:#0f2f27; --del:#3d1d21; --delnum:#321a1d; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--ink); color:var(--text); font:400 15px/1.45 "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif; }
nav { display:flex; gap:16px; padding:12px 18px; border-bottom:1px solid var(--rule); background:var(--row); } nav a { color:var(--soft); text-decoration:none; }
header { padding:14px 18px 6px; } h1 { margin:0; font-size:21px; font-weight:600; }
.meta { color:var(--mute); margin-top:2px; } .msg { white-space:pre-wrap; color:var(--soft); margin:8px 0 0; max-width:100ch; }
.sum { margin-top:8px; } .p { color:var(--done); } .m { color:var(--hot); }
.toc { padding:6px 18px 10px; columns: 2 360px; } .toc a { display:block; color:var(--soft); text-decoration:none; font-size:14px; } .toc a:hover { color:var(--text); }
.file { margin:12px 18px; border:1px solid var(--rule); border-radius:6px; overflow:hidden; }
.fh { display:flex; gap:12px; align-items:baseline; padding:8px 12px; background:var(--row); border-bottom:1px solid var(--rule); position:sticky; top:0; z-index:1; flex-wrap:wrap; }
.fh .path { font-weight:600; overflow-wrap:anywhere; } .fh .st { color:var(--mute); font-size:13px; } .fh button { margin-left:auto; font:inherit; font-size:13px; color:var(--soft); background:transparent; border:1px solid var(--rule); border-radius:4px; padding:1px 8px; cursor:pointer; }
table { border-collapse:collapse; width:100%; font:12.5px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; }
td { padding:0 8px; vertical-align:top; } td.num { width:1%; color:var(--dim); text-align:right; user-select:none; white-space:nowrap; }
td.code { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text); }
tr.a td.code { background:var(--add); } tr.a td.num { background:var(--addnum); color:#4f8f7f; }
tr.d td.code { background:var(--del); } tr.d td.num { background:var(--delnum); color:#9a5a5f; }
td.sign { width:1%; user-select:none; color:var(--dim); padding:0 2px; } tr.a td.sign { color:var(--done); } tr.d td.sign { color:var(--hot); }
tr.gap td { background:#101b2b; color:var(--mute); font-family:"Barlow Semi Condensed", sans-serif; font-size:13px; padding:3px 12px; }
.md { padding:6px 14px; } .md .blk { padding:2px 10px; border-left:3px solid transparent; } .md .blk.a { border-left-color:var(--done); background:var(--add); }
.md .blk.d { border-left-color:var(--hot); background:var(--del); opacity:.75; text-decoration:line-through; text-decoration-color:rgba(240,122,90,.5); }
.md .gapmd { color:var(--mute); font-size:13px; padding:4px 10px; } .md a { color:var(--done); } .md code { font-size:13px; } .md pre { background:var(--row); padding:8px; overflow:auto; }
.md table { font:inherit; } .md td, .md th { border:1px solid var(--rule); padding:2px 6px; }
.bin { padding:10px 14px; color:var(--mute); }
.hljs-keyword,.hljs-built_in,.hljs-selector-tag { color:#c99bf0; } .hljs-string,.hljs-attr,.hljs-template-tag { color:#9fd58a; } .hljs-number,.hljs-literal { color:#f0b072; }
.hljs-comment { color:#6c819a; font-style:italic; } .hljs-title,.hljs-function .hljs-title,.hljs-title.function_ { color:#7cc3f5; } .hljs-type,.hljs-class .hljs-title { color:#f3d36b; }
.imgs { padding:0 18px; } .pair { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .pair img { max-width:100%; border:1px solid var(--rule); } figure { margin:12px 0; } figcaption { color:var(--mute); }
.note { padding:8px 18px; color:var(--busy); }
</style>
<nav><a href="/board">board</a><a href="/board/jobs">all jobs</a></nav>
<header><h1>${esc(o.title)}</h1>${o.meta.map((m) => `<div class="meta">${esc(m)}</div>`).join("")}
${o.message ? `<p class="msg">${esc(o.message)}</p>` : ""}<div class="sum">${o.files.length} files · <span class="p">+${adds}</span> <span class="m">−${dels}</span></div></header>
${o.note ? `<div class="note">${esc(o.note)}</div>` : ""}
<div class="toc">${o.files.map((f, i) => `<a href="#f${i}">${esc(f.path)} <span class="p">+${f.adds}</span> <span class="m">−${f.dels}</span></a>`).join("")}</div>
${o.extraHtml ? `<div class="imgs">${o.extraHtml}</div>` : ""}
<main id="files"></main>
${o.raw ? `<noscript><pre>${esc(o.raw)}</pre></noscript>` : ""}
<script type="application/json" id="diff-data">${data}</script>
<script type="module">
const files = JSON.parse(document.getElementById("diff-data").textContent);
let hljs = null, md = null;
try { const L = await import("/board/vendor/libs.js"); hljs = L.hljs || null; if (L.MarkdownIt) md = new L.MarkdownIt({ html: false, linkify: true }); } catch {}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LANG = { ts:"typescript", tsx:"typescript", js:"javascript", mjs:"javascript", cjs:"javascript", jsx:"javascript", rs:"rust", py:"python", sh:"bash", ps1:"bash", json:"json", toml:"ini", ini:"ini", sql:"sql", c:"c", h:"c", cpp:"c", sol:"solidity" };
const langOf = (p) => LANG[(p.split(".").pop() || "").toLowerCase()];
const hl = (s, lang) => { if (!hljs || !lang) return esc(s); try { return hljs.highlight(s, { language: lang, ignoreIllegals: true }).value; } catch { return esc(s); } };
const gapRow = (from, to) => to >= from ? '<tr class="gap"><td colspan="4">⋯ lines ' + from + (to > from ? '–' + to : '') + ' unchanged</td></tr>' : "";
function table(f) {
  const lang = langOf(f.path); let rows = "", nextOld = 1;
  for (const h of f.hunks) {
    rows += gapRow(nextOld, h.oldStart - 1);
    for (const l of h.lines) {
      const cls = l.t === "+" ? "a" : l.t === "-" ? "d" : "";
      rows += '<tr class="' + cls + '"><td class="num">' + (l.o ?? "") + '</td><td class="num">' + (l.n ?? "") + '</td><td class="sign">' + (l.t === " " ? "" : l.t) + '</td><td class="code">' + (hl(l.s, lang) || " ") + '</td></tr>';
      if (l.o != null) nextOld = l.o + 1;
    }
  }
  return "<table>" + rows + "</table>";
}
function markdown(f) {
  if (!md) return null;
  let out = "", nextOld = 1;
  for (const h of f.hunks) {
    if (h.oldStart - 1 >= nextOld) out += '<div class="gapmd">⋯ lines ' + nextOld + '–' + (h.oldStart - 1) + ' unchanged</div>';
    let run = [], kind = null;
    const flush = () => { if (!run.length) return; out += '<div class="blk ' + (kind === "+" ? "a" : kind === "-" ? "d" : "") + '">' + md.render(run.join("\\n")) + "</div>"; run = []; };
    for (const l of h.lines) { if (l.t !== kind) { flush(); kind = l.t; } run.push(l.s); if (l.o != null) nextOld = l.o + 1; }
    flush();
  }
  return '<div class="md">' + out + "</div>";
}
const status = { added: "new file", deleted: "deleted", renamed: "renamed", modified: "", binary: "binary" };
document.getElementById("files").innerHTML = files.map((f, i) => {
  const isMd = /\\.(md|markdown)$/i.test(f.path) && f.hunks.length;
  const body = f.status === "binary" || !f.hunks.length ? '<div class="bin">' + (f.status === "binary" ? "binary file" : "no text change") + "</div>"
    : (isMd && md ? '<div class="view rendered">' + markdown(f) + '</div><div class="view raw" hidden>' + table(f) + "</div>" : table(f));
  return '<section class="file" id="f' + i + '"><div class="fh"><span class="path">' + esc(f.oldPath ? f.oldPath + " → " + f.path : f.path) + '</span><span class="p">+' + f.adds + '</span><span class="m">−' + f.dels + '</span><span class="st">' + (status[f.status] || "") + "</span>" + (isMd && md ? '<button type="button" data-toggle>raw diff</button>' : "") + "</div>" + body + "</section>";
}).join("");
document.addEventListener("click", (e) => { const b = e.target.closest("[data-toggle]"); if (!b) return;
  const s = b.closest(".file"); const r = s.querySelector(".rendered"), w = s.querySelector(".raw"); const raw = w.hidden;
  w.hidden = !raw; r.hidden = raw; b.textContent = raw ? "rendered" : "raw diff"; });
</script></html>`;
}
