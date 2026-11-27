/** Card evidence is descriptive: parsing never executes a command or resolves an arbitrary URL. */
import path from "node:path";
import { openSync, readSync, closeSync, realpathSync, statSync } from "node:fs";
import { artifactHref, safeArtifact } from "./project-arpe.ts";
import { parseCheckDeclaration, type CheckService } from "./checks.ts";
import type { Goal } from "./goals.ts";

export type ProofTab = { kind: "file" | "diff" | "url"; label: string; href: string; path?: string; preview?: "markdown" | "image" | "pdf" | "data" | "code" | "download" | "unavailable" };
export type CardTab = { kind: "card" | "check"; label: string } | ProofTab;
const fileTypes = /\.(?:md|markdown|png|jpe?g|gif|webp|svg|pdf|csv|tsv|jsonl?|txt|log|ts|tsx|js|jsx|mjs|cjs|py|ps1|sh|bash|go|rs|java|kt|c|cpp|h|hpp|cs|rb|php|sql|html|css|scss|xml|ya?ml|toml|ini|bat|cmd|lua|vue|svelte|diff|patch|zip|docx|xlsx|pptx|wasm|mp4|webm)$/i;
const safeRelative = (s: string) => !!s && !s.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git" || /[:\x00-\x1f]/.test(p));
function preview(file: string): ProofTab["preview"] {
  if (/\.(md|markdown)$/i.test(file)) return "markdown";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file)) return "image";
  if (/\.pdf$/i.test(file)) return "pdf";
  if (/\.(csv|tsv|jsonl?)$/i.test(file)) return "data";
  return fileTypes.test(file) && !/\.(zip|docx|xlsx|pptx|wasm|mp4|webm)$/i.test(file) ? "code" : "download";
}
export function parseProofTabs(ray: string, proofs: string | string[] | undefined, root?: string): ProofTab[] {
  const text = Array.isArray(proofs) ? proofs.join("\n") : proofs ?? "";
  const found: { at: number; tab: ProofTab }[] = [];
  const addFile = (raw: string, at: number, explicit = false) => {
    let relative = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!explicit && !fileTypes.test(relative) && !(/\//.test(relative) && /\.[a-z0-9]{1,10}$/i.test(relative)) && !(root && safeArtifact(root, ray, relative))) return;
    if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      // Absolute proof paths are still named evidence. Only ray-contained files are served.
      const rel = root && path.isAbsolute(relative) ? path.relative(path.resolve(root, ray), path.resolve(relative)).replace(/\\/g, "/") : "";
      if (safeRelative(rel)) relative = rel;
      else {
        if (!fileTypes.test(relative)) return;
        found.push({ at, tab: { kind: "file", label: relative.split("/").pop()!, path: relative, href: "", preview: "unavailable" } });
        return;
      }
    }
    if (!safeRelative(relative)) return;
    found.push({ at, tab: { kind: "file", label: relative.split("/").pop()!, path: relative, href: artifactHref(ray, relative), preview: preview(relative) } });
  };
  const addCommit = (hash: string, at: number, repo?: string) => {
    const href = `/board/diff?ray=${encodeURIComponent(ray)}&hash=${hash.toLowerCase()}` + (repo ? `&repo=${encodeURIComponent(repo)}` : "");
    found.push({ at, tab: { kind: "diff", label: `Diff ${hash.slice(0, 7)}`, href } });
  };
  const addUrl = (raw: string, at: number, label?: string) => {
    try {
      const u = new URL(raw, "http://board.invalid");
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return;
      const relative = raw.startsWith("/") && !raw.startsWith("//");
      if (!relative && !/^https?:\/\//i.test(raw)) return;
      const href = relative ? u.pathname + u.search + u.hash : u.href;
      const diff = u.pathname === "/board/diff" && relative;
      found.push({ at, tab: { kind: diff ? "diff" : "url", label: diff ? "Diff" : label || (relative ? u.pathname : u.hostname), href } });
    } catch {}
  };
  // Mask consumed spans without changing offsets, so Markdown, URLs and bare tokens never double count.
  let bare = text.replace(/\[([^\]\r\n]+)\]\(([^)\r\n]+)\)|\[commit ([0-9a-f]{7,40})\]/gi, (all, label, dest, hash, at) => {
    if (hash) addCommit(hash, at);
    else if (/^(?:https?:\/\/|\/(?:board|api)\/)/i.test(dest)) addUrl(dest, at, label);
    else addFile(dest, at, true);
    return " ".repeat(all.length);
  });
  bare = bare.replace(/https?:\/\/[^\s<>"'`]+|\/(?:board|api)\/[\w/?&=.%+#~-]+/gi, (all, at) => {
    addUrl(all.replace(/[),;.!]+$/, ""), at); return " ".repeat(all.length);
  });
  bare = bare.replace(/\b([\w.-]+)(?:\s+(?:commit\s+)?|[@:]\s*)([0-9a-f]{7,40})\b/gi, (all, repo, hash, at) => {
    addCommit(hash, at, repo.toLowerCase() === "commit" ? undefined : repo); return " ".repeat(all.length);
  });
  // Paths in backticks may contain spaces; bare paths are whitespace delimited.
  bare = bare.replace(/`([^`\r\n]+)`/g, (all, file, at) => {
    if (fileTypes.test(file)) { addFile(file, at); return " ".repeat(all.length); } return all;
  });
  for (const m of bare.matchAll(/(?:^|[\s(`'";,])((?:[A-Za-z]:[\\/]|\/|\.\/)?[\w.-]+(?:[\\/][\w.-]+)*\.[A-Za-z0-9]{1,10})(?=$|[\s),;`'"\]]|\.(?:\s|$))/g)) addFile(m[1]!, m.index!);
  // If a generic [commit ...] and exactly one named repo identify the same hash,
  // prefer the named link, keeping the first mention's position.
  const named = new Map<string, ProofTab[]>();
  for (const {tab} of found) {
    if (tab.kind !== "diff") continue;
    const u = new URL(tab.href, "http://board.invalid"), hash = u.searchParams.get("hash");
    if (hash && u.searchParams.has("repo")) {
      const candidates = named.get(hash) ?? [];
      if (!candidates.some(t => t.href === tab.href)) candidates.push(tab);
      named.set(hash, candidates);
    }
  }
  const seen = new Set<string>();
  return found.sort((a,b) => a.at-b.at).map(({tab}) => {
    if (tab.kind !== "diff") return tab;
    const u = new URL(tab.href, "http://board.invalid"), hash = u.searchParams.get("hash");
    const matches = hash && !u.searchParams.has("repo") ? named.get(hash) : undefined;
    return matches?.length === 1 ? matches[0]! : tab;
  }).filter(t => {
    const key = t.kind === "file" ? "file:" + t.path : t.kind + ":" + t.href;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
export const cardTabs = (ray: string, proofs: string | string[] | undefined, root?: string): CardTab[] =>
  [{ kind: "card", label: "Card" }, ...parseProofTabs(ray, proofs, root), { kind: "check", label: "Check" }];

/** Bounded source preview; never interpret binary files or follow a path outside its allowed root. */
export function sourcePreview(file: string, maxLines = 80) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(256 * 1024), n = readSync(fd, buf, 0, buf.length, 0);
    const bytes = buf.subarray(0, n);
    if (bytes.includes(0)) return null;
    const lines = bytes.toString("utf8").split(/\r?\n/);
    return { text: lines.slice(0, maxLines).join("\n"), truncated: lines.length > maxLines || statSync(file).size > n };
  } finally { closeSync(fd); }
}
function localScript(root: string, ray: string, codeRoot: string, argv: string[]) {
  // A direct script, or an interpreter followed by a script. Do not inspect arbitrary data arguments.
  const exe = argv[0]!;
  const interpreter = /^(?:bun|node|deno|python\d*(?:\.\d+)?|pwsh|powershell|bash|sh|ruby|perl|tsx)(?:\.exe)?$/i.test(exe.replace(/\\/g,"/").split("/").pop()!);
  const args = argv.slice(1);
  // Inline programs and module invocations are not local script files.
  if (interpreter && args.some(a => /^(?:-e|--eval|-c|-command|-encodedcommand|-m|-p|--print)$/i.test(a))) return null;
  const candidate = interpreter ? args.find(a => !a.startsWith("-") && !["run", "test"].includes(a)) : exe;
  if (!candidate || (!/\.(?:[cm]?[jt]sx?|py|ps1|sh|bash|rb|pl|cmd|bat)$/i.test(candidate) && !/[\\/]/.test(candidate))) return null;
  try {
    let file: string | null = null;
    if (path.isAbsolute(candidate)) {
      const target = realpathSync(candidate);
      for (const base of [path.join(root, ray), codeRoot]) {
        const relative = path.relative(realpathSync(base), target).replace(/\\/g,"/");
        if (safeRelative(relative) && !path.isAbsolute(relative) && statSync(target).isFile()) { file = target; break; }
      }
    } else file = safeArtifact(root, ray, candidate.replace(/\\/g,"/").replace(/^\.\//,""));
    if (!file) return null;
    const source = sourcePreview(file);
    return source ? { path: candidate, ...source } : null;
  } catch { return null; }
}
export function cardCheck(root: string, ray: string, codeRoot: string, goal: Goal, checks: CheckService, demo = false) {
  const declaration = (goal.checkDeclarations ?? []).join("\n");
  const spec = parseCheckDeclaration(declaration);
  return { declaration, acceptance: goal.check.split(/\r?\n/).filter(line => !(goal.checkDeclarations ?? []).includes(line.trim())).join("\n"), script: spec?.kind === "run" ? localScript(root, ray, codeRoot, spec.argv) : null,
    last: checks.light(ray, goal), runnable: !demo && !!spec && spec.kind !== "manual" };
}
