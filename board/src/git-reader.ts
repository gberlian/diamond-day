/** Render only an applied ledger hash, in repository paths named in that ray's README table. */
import { readFileSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { loadConfig } from "./config.ts";
const execute = promisify(execFile);
const esc = (x: unknown) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function readmeRepos(readme: string): string[] {
  const found = new Set<string>();
  let repoTable = false;
  for (const line of readme.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { repoTable = false; continue; }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*/g, ""));
    if (cells.some((c) => /^(?:repo(?:sitory)?|code repo|project|project path|repo path)$/i.test(c))) {
      repoTable = true;
      continue;
    }
    if (!repoTable || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    // Table schemas vary by ray: sometimes the absolute path is in Repo,
    // sometimes in Path or Local checkout. Examine only repository-table rows.
    for (const raw of cells) {
      const matches = raw.match(/(?:[a-zA-Z]:[\\/]|\/)[^\s`|<>)\]]+/g) ?? [];
      for (const item of matches) found.add(item.replace(/[.,;:]$/, ""));
    }
  }
  return [...found];
}

/** Ray README tables can give repository names without their checkout paths. */
export function readmeRepoNames(readme: string): string[] {
  const found = new Set<string>();
  let col = -1;
  for (const line of readme.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { col = -1; continue; }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const header = cells.findIndex((c) => /^(?:repo(?:sitory)?|code repo|project)$/i.test(c.replace(/\*/g, "")));
    if (header >= 0) { col = header; continue; }
    if (col < 0) continue;
    const value = (cells[col] ?? "").replace(/`/g, "").replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1").trim();
    if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && !/^[-:]+$/.test(value)) found.add(value);
  }
  return [...found];
}

export async function appliedDiff(root: string, ray: string, hash: string): Promise<{ repo: string; text: string } | null> {
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(ray) || !/^[a-f0-9]{7,64}$/i.test(hash)) return null;
  let md: string;
  try { md = readFileSync(path.join(root, ray, "README.md"), "utf8"); } catch { return null; }
  const codeRoot = loadConfig().codeRoot;
  const candidates = [...new Set([...readmeRepos(md), ...readmeRepoNames(md).map((name) => path.join(codeRoot, name))])];
  for (const candidate of candidates) {
    try {
      const repo = realpathSync(candidate);
      const { stdout } = await execute("git", ["-C", repo, "show", "--stat", "--patch", "--no-ext-diff", hash], {
        timeout: 12_000, maxBuffer: 6 * 1024 * 1024, windowsHide: true,
      });
      return { repo: candidate, text: stdout };
    } catch { /* A ray can list multiple repositories; locate the commit in another. */ }
  }
  return null;
}

export async function renderAppliedDiff(root: string, ray: string, hash: string): Promise<Response> {
  const result = await appliedDiff(root, ray, hash);
  const body = result
    ? `<h1>${esc(ray)} · ${esc(hash)}</h1><p>${esc(result.repo)}</p><pre>${esc(result.text)}</pre>`
    : `<h1>Diff unavailable</h1><p>No matching commit in the repositories listed in ${esc(ray)}/README.md.</p>`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Commit ${esc(hash)}</title><style>body{margin:24px auto;padding:0 16px;max-width:1200px;background:#0e1621;color:#e3eaf2;font:14px/1.5 ui-monospace,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;color:#b6c3d1}p{color:#7c8fa4}</style>${body}</html>`, {
    status: result ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
