/** Shared companies have a deliberately small API. Never forward a guest request to the owner router. */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { parseRpm, setResultField, EditError } from "./rpm.ts";
import { DecisionService, DecisionError, safeImage } from "./decisions.ts";
type LedgerJob = {ray: string; name: string; state: string; startedAt?: string; finishedAt?: string; appliedCommit?: string};
const ledgerRay = (j: LedgerJob) => j.ray;
import { validName } from "./projects.ts";
import { sharedPage, joinPage, sharingPage } from "./companies-page.ts";
export type Role = "viewer" | "editor";
export type Member = { id: string; person: string; role: Role; hash?: string; expiresAt?: number; revoked?: boolean };
type Members = { members: Member[]; artifacts: string[]; decisions: string[]; handoffs: string[] };
type Options = { root: string; dataDir: string; actions: boolean; ownerToken: string; shareOrigin?: string; sharePort?: number; clock?: () => number; jobs?: () => Promise<LedgerJob[]>; fetchRemote?: typeof fetch };
type Connection = { id: string; url: string; token: string };
const name = /^[a-zA-Z0-9][\w.-]{0,63}$/;
const idPattern = /^[a-zA-Z0-9][\w-]{0,79}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const role = (x: unknown): x is Role => x === "viewer" || x === "editor";
const v4 = [127,0,0,1].join(".");
const loopback = (ip?: string) => ip === v4 || ip === "::1" || ip === `::ffff:${v4}`;
const localHost = (host: string) => [v4, "localhost", "[::1]"].includes(host);
const tsHost = (host: string) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$/.test(host);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const json = (v: unknown, status = 200) => Response.json(v, {status, headers});
const missing = () => json({error: "not_found"}, 404);
const html = (s: string) => new Response(s, {headers: {...headers, "content-type": "text/html; charset=utf-8"}});
class SharingError extends Error { readonly status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const fail = (s: string, status = 400): never => { throw new SharingError(s, status); };
const empty = (): Members => ({members: [], artifacts: [], decisions: [], handoffs: []});
// Reject junctions/symlinks at every component, including write destinations. Do not follow paths supplied by guests.
function child(base: string, relative: string, kind: "file" | "dir", create = false): string {
  const pieces = relative.split("/");
  if (pieces.some(p => !p || p === "." || p === ".." || /[\\:\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail("unsafe path", 404);
  let target = base;
  for (let i = 0; i < pieces.length; i++) {
    const parent = target; target = path.join(target, pieces[i]!);
    const directory = i < pieces.length - 1 || kind === "dir";
    if (create && directory && !existsSync(target)) mkdirSync(target);
    if (create && !directory && !existsSync(target)) return target;
    const st = lstatSync(target);
    const actual = realpathSync(target);
    const same = process.platform === "win32" ? actual.toLowerCase() === target.toLowerCase() : actual === target;
    if (st.isSymbolicLink() || !same || path.dirname(target) !== parent || !(directory ? st.isDirectory() : st.isFile()) || (!directory && st.nlink !== 1)) fail("unsafe path", 404);
  }
  return target;
}
function atomic(file: string, value: string) {
  const tmp = file + "." + random() + ".tmp";
  try { writeFileSync(tmp, value, {flag: "wx", mode: 0o600}); renameSync(tmp, file); }
  finally { rmSync(tmp, {force: true}); }
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max || !value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail("invalid text");
  return value as string;
}
function single(value: unknown, max = 4096): string {
  const v = text(value, max); if (/[\r\n]/.test(v)) fail("use one line"); return v.trim();
}
// Stable result numbers are agent references. Move whole sections without renumbering or rewriting their content.
function reorder(md: string, ids: string[]): string {
  const headings = [...md.matchAll(/^##[ \t]+(\d+)[ \t]*[.)][ \t]*[^\r\n]+/gm)];
  const keys = headings.map(h => h[1]!);
  if (!keys.length || new Set(keys).size !== keys.length || ids.length !== keys.length || new Set(ids).size !== ids.length || !ids.every(id => keys.includes(id))) fail("ids must list every result once");
  // Do not move unrelated headings or epilogues into results.
  const endOf = (h: RegExpMatchArray) => { const start = h.index! + h[0].length; const next = /^#{1,2}[ \t]+/m.exec(md.slice(start)); return next ? start + next.index : md.length; };
  const blocks = headings.map(h => ({id: h[1]!, start: h.index!, end: endOf(h)}));
  if (blocks.some((b,i) => i < blocks.length-1 && b.end !== blocks[i+1]!.start)) fail("interleaved non-result headings; reorder locally", 409);
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const last = blocks.at(-1)!;
  // Separate trailing newlines from each block; keep the original separator at each slot.
  const segments = blocks.map(b => { const raw = md.slice(b.start,b.end); const suffix = /(?:\r?\n)+$/.exec(raw)?.[0] ?? ""; return {id:b.id, content:raw.slice(0,raw.length-suffix.length), suffix}; });
  return md.slice(0,blocks[0]!.start) + ids.map((id,i) => segments.find(b=>b.id===id)!.content + (segments[i]!.suffix || (i<ids.length-1?eol:""))).join("") + md.slice(last.end);
}
function artifactName(value: string) {
  // Only explicitly reviewed presentation files, never dotfiles, private/internal folders, executable or raw credential formats.
  return /^(?:docs|decisions\/images)\//.test(value) && value.length <= 500 && value.split("/").every(p => /^[\w][\w .-]*$/.test(p) && !/^(?:internal|private|secrets?|credentials?|node_modules|comments)$/i.test(p)) && /\.(?:md|txt|patch|diff|png|jpe?g|gif|webp|avif|pdf)$/i.test(value) && !/(?:^|[\/._-])(?:secrets?|credentials?|passwords?|tokens?|api[-_]?keys?)(?:[\/._-]|$)/i.test(value);
}
async function body(req: Request): Promise<any> {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const u = new URL(req.url);
  // Tailscale Serve may terminate HTTPS before forwarding to HTTP; match the external host exactly.
  if ((site && !["same-origin", "none"].includes(site)) || (origin && origin !== u.origin && !(tsHost(u.hostname) && origin === `https://${u.host}`))) fail("cross_origin_denied", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) fail("json_required", 415);
  const reader = req.body?.getReader(); if (!reader) fail("invalid JSON");
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) { const next = await reader!.read(); if (next.done) break; bytes += next.value.length; if (bytes > 64 * 1024) { await reader!.cancel(); fail("body too large", 413); } chunks.push(next.value); }
  try { const b = JSON.parse(Buffer.concat(chunks).toString()); if (!b || typeof b !== "object" || Array.isArray(b)) fail("invalid JSON"); return b; } catch { return fail("invalid JSON"); }
}
export function ownerRequest(req: Request, peer?: string) {
  return (peer === undefined || loopback(peer)) && localHost(new URL(req.url).hostname) && ![...req.headers.keys()].some(k => /^(?:tailscale-|x-forwarded-|forwarded$)/i.test(k));
}
export function remoteCompanyUrl(input: string): URL {
  const u = new URL(input);
  if (u.protocol !== "https:" || !tsHost(u.hostname) || u.username || u.password || u.search || u.hash || !/^\/c\/[a-zA-Z0-9][\w.-]{0,63}$/.test(u.pathname)) fail("use an HTTPS Tailscale company URL (/c/company)");
  return u;
}
export class Companies {
  readonly clock: () => number;
  private decisions: DecisionService;
  readonly options: Options;
  constructor(options: Options) { this.options = options; this.clock = options.clock ?? Date.now; this.decisions = new DecisionService(options.root, this.clock); }
  private folder(ray: string) { if (!validName(ray)) fail("not_found", 404); return child(realpathSync(this.options.root), ray, "dir"); }
  private file(ray: string, relative: string, create = false) { return child(this.folder(ray), relative, "file", create); }
  private load(ray: string): Members {
    this.file(ray, "GOALS.md");
    const base = this.folder(ray); if (!existsSync(path.join(base, ".board", "members.json"))) return empty();
    const data = JSON.parse(readFileSync(this.file(ray, ".board/members.json"), "utf8"));
    if (!Array.isArray(data.members) || !Array.isArray(data.artifacts) || !Array.isArray(data.decisions) || !Array.isArray(data.handoffs)) fail("invalid members file", 500);
    return data;
  }
  private save(ray: string, data: Members) { atomic(this.file(ray, ".board/members.json", true), JSON.stringify(data, null, 2) + "\n"); }
  invite(ray: string, person: string, access: Role, ttlHours: number) {
    person = single(person, 100); if (!role(access) || !Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24 * 90) fail("invalid role or expiry");
    const data = this.load(ray); const token = random();
    const member: Member = {id: randomBytes(12).toString("hex"), person, role: access, expiresAt: this.clock() + ttlHours * 3600000,
      hash: hash(token)};
    data.members.push(member); this.save(ray, data); return {member: this.publicMember(member), token};
  }
  private publicMember({hash: _hash, ...m}: Member) { return m; }
  revoke(ray: string, id: string) { const data = this.load(ray); const m = data.members.find(m => m.id === id); if (!m) return fail("not_found", 404); m.revoked = true; this.save(ray, data); }
  private identify(req: Request, ray: string, listener: "tailnet" | "owner" | "token", peer?: string, explicit?: string): Member | undefined {
    const data = this.load(ray);
    const live = data.members.filter(m => role(m.role) && !m.revoked && (m.expiresAt ?? 0) > this.clock());
    const cookie = req.headers.get("cookie")?.split(/;\s*/).find(s => s.startsWith("ray_invite="))?.slice(11);
    const bearer = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    const token = explicit ?? bearer ?? cookie;
    const digest = token && tokenPattern.test(token) ? hash(token) : undefined;
    return live.find(m => !!digest && m.hash === digest);
  }
  private published(ray: string, data: Members) { return data.artifacts.filter(p => typeof p === "string" && artifactName(p) && (() => {try { this.file(ray, p); return true; } catch {return false;}})()); }
  private safeDecisions(ray: string, data: Members): string[] {
    return data.decisions.filter(id => {
      if (!idPattern.test(id)) return false;
      let found = false;
      try {
        for (const area of ["", "pending/", "answered/"]) {
          const relative = `decisions/${area}${id}.json`;
          if (!existsSync(path.join(this.folder(ray), relative))) continue;
          this.file(ray, relative); found = true;
          const ans = `decisions/${area}${id}.answer.json`;
          if (existsSync(path.join(this.folder(ray),ans))) this.file(ray,ans);
        }
      } catch { return false; }
      return found;
    });
  }
  private snapshot(ray: string, member: Member, data: Members, jobs: LedgerJob[]) {
    const md = readFileSync(this.file(ray, "GOALS.md"), "utf8"), rpm = parseRpm(md, ray);
    const artifacts = this.published(ray, data);
    const decisions = this.decisions.list([ray], this.safeDecisions(ray, data)).filter(d => d.decision && d.state !== "error").map(d => ({...d, decision: {...d.decision!, options: d.decision!.options.map(o => ({...o, images: (o.images ?? []).filter(p => artifacts.includes(p))}))}}));
    const handoffs = jobs.filter(j => ledgerRay(j) === ray && data.handoffs.includes(j.name)).map(j => ({name: j.name, state: j.state, startedAt: j.startedAt, finishedAt: j.finishedAt, applied: j.appliedCommit}));
    return {...rpm, ray, role: member.role, editEnabled: member.role === "editor" && this.options.actions, revision: hash(md), artifacts, decisions, handoffs};
  }
  private audit(ray: string, m: Member, entry: unknown) {
    const day = new Date(this.clock()).toISOString().slice(0, 10), slug = m.person.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "member";
    appendFileSync(this.file(ray, `plans/${day}-from-${slug}-${m.id.slice(0,8)}-board.md`, true), `\n- ${new Date(this.clock()).toISOString()} ${JSON.stringify({person: m.person, entry})}\n`, {mode: 0o600});
  }
  private edit(ray: string, m: Member, b: any) {
    const file = this.file(ray, "GOALS.md"), md = readFileSync(file, "utf8");
    if (b.revision !== hash(md)) fail("GOALS.md changed; reload and retry", 409);
    const before = parseRpm(md, ray); let next: string;
    if (b.op === "result" && ["result", "purpose"].includes(b.key) && typeof b.id === "string") next = setResultField(md, b.id, b.key, single(b.value));
    else if (b.op === "reorder" && Array.isArray(b.ids) && b.ids.every((x: unknown) => typeof x === "string")) next = reorder(md, b.ids);
    else if (b.op === "add") {
      const title = single(b.title, 200), result = single(b.result), purpose = single(b.purpose);
      const n = Math.max(0, ...before.results.map(r => Number(r.id))) + 1;
      const eol = md.includes("\r\n") ? "\r\n" : "\n";
      const last = [...md.matchAll(/^##[ \t]+\d+[ \t]*[.)][ \t]*[^\r\n]+/gm)].at(-1);
      const offset = last ? last.index! + last[0].length : 0;
      const epilogue = last ? /^#{1,2}[ \t]+/m.exec(md.slice(offset)) : null;
      const pos = epilogue ? offset + epilogue.index : md.length;
      const prefix = md.slice(0,pos), suffix = md.slice(pos);
      next = prefix + (prefix.endsWith(eol+eol) ? "" : prefix.endsWith(eol) ? eol : eol+eol) + [`## ${n}. ${title}`, `- **Result:** ${result}`, `- **Purpose:** ${purpose}`, "- **Plan:**", "", ""].join(eol) + suffix;
    } else return fail("Execution belongs to the agent", 403);
    const after = parseRpm(next, ray);
    if (b.op === "result" && after.results.find(r=>r.id===b.id)?.[b.key as "result"|"purpose"] !== single(b.value)) fail("field cannot be represented without changing Markdown", 409);
    const expected = b.op === "reorder" ? b.ids.map((id: string) => before.results.find(r => r.id === id)) : before.results;
    if (after.results.length !== before.results.length + (b.op === "add" ? 1 : 0) || expected.some((r: any, i: number) => JSON.stringify(r.steps) !== JSON.stringify(after.results[i]?.steps))) fail("edit would change Execution", 409);
    if (next !== md) { const entry = {op: b.op, id: b.id, key: b.key, ids: b.ids, value: b.value, title: b.title, result: b.result, purpose: b.purpose, before: hash(md), after: hash(next)}; this.audit(ray, m, {...entry, state: "prepared"}); atomic(file, next); this.audit(ray, m, {...entry, state: "committed"}); }
    return {ok: true, revision: hash(next)};
  }
  private commentTarget(s: ReturnType<Companies["snapshot"]>, target: string) {
    if (target.startsWith("artifact:")) return s.artifacts.includes(target.slice(9));
    if (target.startsWith("handoff:")) return s.handoffs.some(j => target === `handoff:${j.name}`);
    if (target.startsWith("card:")) return s.results.some(r => r.steps.some(c => target === `card:${r.id}:${c.index}:${hash(c.raw).slice(0,12)}`));
    return false;
  }
  private commentFile(ray: string, target: string, create = false) { return this.file(ray, `docs/comments/${target.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,60)}-${hash(target).slice(0,16)}.md`, create); }
  async handle(req: Request, listener: "tailnet" | "owner" | "token", peer?: string): Promise<Response> {
    try {
      if (listener === "tailnet" && !loopback(peer)) return missing();
      const u = new URL(req.url), p = u.pathname;
      if (p === "/join" && req.method === "GET") return html(joinPage());
      if (p === "/join" && req.method === "POST") {
        const b = await body(req); if (typeof b.ray !== "string" || typeof b.token !== "string") return missing();
        const m = this.identify(req, b.ray, listener, peer, b.token); if (!m) return missing();
        const secure = u.protocol === "https:" || tsHost(u.hostname);
        return Response.json({ok: true, href: `/c/${b.ray}`}, {headers: {...headers, "set-cookie": `ray_invite=${b.token}; Path=/c/${b.ray}; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((m.expiresAt! - this.clock()) / 1000))}${secure ? "; Secure" : ""}`}});
      }
      const match = /^\/c\/([a-zA-Z0-9][\w.-]{0,63})(?:\/api(?:\/(artifact|edit|comment|answer))?)?$/.exec(p);
      if (!match) return missing();
      const ray = match[1]!, action = match[2];
      let member: Member | undefined; try { member = this.identify(req, ray, listener, peer); } catch { return missing(); }
      if (!member) return missing();
      if (p === `/c/${ray}`) return req.method === "GET" ? html(sharedPage(ray)) : missing();
      const data = this.load(ray);
      if (action === "artifact" && req.method === "GET") {
        const rel = u.searchParams.get("path") ?? ""; if (!this.published(ray, data).includes(rel)) return missing();
        const file = this.file(ray, rel); if (lstatSync(file).size > 32 * 1024 * 1024) fail("artifact too large", 413);
        const image = /\.(?:png|jpe?g|gif|webp|avif)$/i.test(rel);
        const mime = image ? safeImage(this.folder(ray), rel).mime : /\.pdf$/i.test(rel) ? "application/octet-stream" : "text/plain; charset=utf-8";
        return new Response(readFileSync(file), {headers: {...headers, "content-type": mime, ...(mime === "application/octet-stream" ? {"content-disposition": "attachment"} : {})}});
      }
      if (!action && req.method === "GET") {
        const jobs = await (this.options.jobs?.() ?? Promise.resolve([]));
        // Recheck after await (revocation may have happened during ledger fetch).
        member = this.identify(req, ray, listener, peer); if (!member) return missing();
        const s = this.snapshot(ray, member, this.load(ray), jobs);
        return json({...s, results: s.results.map(r => ({...r, steps: r.steps.map(c => ({...c, target: `card:${r.id}:${c.index}:${hash(c.raw).slice(0,12)}`}))}))});
      }
      if (action === "comment" && req.method === "GET") {
        const target = u.searchParams.get("target") ?? "", jobs = await (this.options.jobs?.() ?? Promise.resolve([]));
        member = this.identify(req, ray, listener, peer); if (!member) return missing();
        if (!this.commentTarget(this.snapshot(ray, member, this.load(ray), jobs), target)) return missing();
        try { return json({text: readFileSync(this.commentFile(ray, target), "utf8").slice(-100000)}); } catch { return json({text: ""}); }
      }
      if (req.method !== "POST" || !action || action === "artifact") return missing();
      if (member.role !== "editor" || !this.options.actions) return json({error: "read_only"}, 403);
      const b = await body(req);
      const jobs = action === "comment" ? await (this.options.jobs?.() ?? Promise.resolve([])) : [];
      member = this.identify(req, ray, listener, peer); if (!member) return missing();
      if (member.role !== "editor") return json({error: "read_only"}, 403);
      if (action === "edit") return json(this.edit(ray, member, b));
      if (action === "comment") {
        const target = single(b.target, 600), message = text(b.text, 8000);
        if (!this.commentTarget(this.snapshot(ray, member, this.load(ray), jobs), target)) return missing();
        const file = this.commentFile(ray, target, true);
        const entry = `\n## ${new Date(this.clock()).toISOString()} · ${member.person}\nTarget: ${target}\n\n${message.split(/\r?\n/).map(l => `> ${l}`).join("\n")}\n`;
        appendFileSync(file, entry, {mode: 0o600}); this.audit(ray, member, {comment: target, file: path.basename(file), text: message}); return json({ok: true});
      }
      if (action === "answer") {
        if (typeof b.id !== "string" || !this.safeDecisions(ray, this.load(ray)).includes(b.id)) return missing();
        const answer = this.decisions.answer(ray, b.id, b.key, b.note, b.change === true, true); this.audit(ray, member, {decision: b.id, answer}); return json({ok: true, answer});
      }
      return missing();
    } catch (e) { return e instanceof SharingError || e instanceof EditError || e instanceof DecisionError ? json({error: e.message}, e.status) : missing(); }
  }
  private connectionFile() { mkdirSync(this.options.dataDir, {recursive: true}); return child(realpathSync(this.options.dataDir), "companies.local.json", "file", true); }
  private connections(): Connection[] { const file = this.connectionFile(); return existsSync(file) ? JSON.parse(readFileSync(file,"utf8")) : []; }
  async owner(req: Request): Promise<Response> {
    try {
      const u = new URL(req.url), p = u.pathname;
      if (p === "/board/sharing" && req.method === "GET") return html(sharingPage());
      if (p === "/api/companies/connections" && req.method === "GET") {
        const cards = await Promise.all(this.connections().map(async c => {
          try { const url = remoteCompanyUrl(c.url); const r = await (this.options.fetchRemote ?? fetch)(url.href + "/api", {headers: {authorization: `Bearer ${c.token}`}, redirect: "error", signal: AbortSignal.timeout(5000)}); if (!r.ok) throw Error();
            const d = await r.json(); return {id: c.id, url: c.url, name: String(d.name), vision: String(d.vision), role: d.role};
          } catch { return {id: c.id, url: c.url, name: c.url, error: "Remote company unavailable"}; }
        })); return json({cards});
      }
      const open = /^\/api\/companies\/connections\/([a-f0-9]+)\/open$/.exec(p);
      if (open && req.method === "GET") { const c = this.connections().find(c => c.id === open[1]); if (!c) return missing(); const url = remoteCompanyUrl(c.url); return new Response(null, {status: 302, headers: {...headers, location: `${url.origin}/join#${encodeURIComponent(url.pathname.slice(3))}/${c.token}`}}); }
      if (p === "/api/companies" && req.method === "GET") {
        const rays = readdirSync(this.options.root).filter(r => { try { this.file(r,"GOALS.md"); return true; } catch {return false;} }); return json({rays, origin:this.options.shareOrigin || (this.options.sharePort ? `http://${v4}:${this.options.sharePort}` : null)});
      }
      const rayMatch = /^\/api\/companies\/([a-zA-Z0-9][\w.-]{0,63})$/.exec(p);
      if (rayMatch && req.method === "GET") { const d = this.load(rayMatch[1]!); return json({...d, members: d.members.map(m => this.publicMember(m))}); }
      if (req.method !== "POST" || !this.options.actions) return json({error: "read_only"}, 403);
      if (req.headers.get("origin") !== u.origin && req.headers.get("authorization") !== `Bearer ${this.options.ownerToken}`) return json({error:"forbidden"},403);
      const b = await body(req);
      if (p === "/api/companies/connections") {
        const connections = this.connections();
        if (b.op === "remove") atomic(this.connectionFile(), JSON.stringify(connections.filter(c => c.id !== b.id)));
        else { const url = remoteCompanyUrl(single(b.url, 500)); if (typeof b.token !== "string" || !tokenPattern.test(b.token)) fail("invalid invite token"); connections.push({id: randomBytes(12).toString("hex"), url: url.href, token: b.token}); atomic(this.connectionFile(), JSON.stringify(connections)); }
        return json({ok: true});
      }
      if (!rayMatch) return missing(); const ray = rayMatch[1]!;
      if (b.op === "invite") { if(!this.options.sharePort) return json({error:"Run ray share start PORT first"},409); return json(this.invite(ray, b.person, b.role, b.ttlHours)); }
      if (b.op === "revoke") { this.revoke(ray, b.id); return json({ok: true}); }
      if (b.op === "publish") {
        const d = this.load(ray);
        if (!Array.isArray(b.artifacts) || !b.artifacts.every((p: unknown) => typeof p === "string" && artifactName(p)) || !Array.isArray(b.decisions) || !b.decisions.every((p: unknown) => typeof p === "string" && idPattern.test(p)) || !Array.isArray(b.handoffs) || !b.handoffs.every((p: unknown) => typeof p === "string" && name.test(p))) fail("invalid publication list");
        for (const p of b.artifacts) this.file(ray, p);
        this.save(ray, {...d, artifacts: [...new Set<string>(b.artifacts)], decisions: [...new Set<string>(b.decisions)], handoffs: [...new Set<string>(b.handoffs)]}); return json({ok: true});
      }
      return missing();
    } catch (e) { return e instanceof SharingError ? json({error: e.message}, e.status) : json({error: "sharing operation failed"}, 400); }
  }
}
