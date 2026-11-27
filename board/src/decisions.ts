#!/usr/bin/env bun
/** Plain-file decision inbox. A ray owns its files; only answers are written by the board. */
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRpm, linkStepDecision } from "./rpm.ts";
import { projectNames } from "./projects.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 128 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const RAY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
};
export type DecisionOption = { key: string; label: string; images?: string[]; detail?: string };
export type Decision = { id: string; title: string; question: string; options: DecisionOption[];
  allowNote: boolean; deadline?: string; createdAt: string };
export type DecisionAnswer = { key: string; note: string; at: string };
export type InboxItem = { ray: string; id: string; state: "pending" | "answered" | "error";
  decision?: Decision; answer?: DecisionAnswer; error?: string; card?: { result: string; index: number; text: string }; folder: "pending" | "answered" };

export class DecisionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = "DecisionError"; }
}
function issue(msg: string): never { throw new DecisionError(400, msg); }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const string = (x: unknown, field: string, limit: number): string => {
  if (typeof x !== "string" || !x.trim() || x.length > limit || x.includes("\0"))
    issue(`${field} must be nonempty text (max ${limit} characters)`);
  return x;
};
const timestamp = (x: unknown, field: string): string => {
  if (typeof x !== "string" || !ISO.test(x) || !Number.isFinite(Date.parse(x)) ||
    new Date(x).toISOString().slice(0, 19) !== x.slice(0, 19))
    issue(`${field} must be a UTC ISO 8601 timestamp`);
  return x;
};
const relPath = (x: unknown): string => {
  if (typeof x !== "string" || !x || x.length > 500 || x.includes("\0") ||
    x.includes(":") || path.isAbsolute(x) || path.win32.isAbsolute(x) ||
    x.startsWith("/") || x.startsWith("\\") || x.split(/[\\/]/).some((p) => !p || p === "." || p === ".."))
    issue(`image path must be relative and remain inside the ray: ${String(x).slice(0, 80)}`);
  return x.replace(/\\/g, "/");
};
/** Validate a JSON object, including option keys and safe relative image path syntax. */
export function validateDecision(raw: unknown, filenameId?: string): Decision {
  if (!object(raw)) issue("decision must be a JSON object");
  if (!ID.test(String(raw.id ?? ""))) issue("id must be 1–80 letters, digits, - or _ (starting with a letter/digit)");
  if (filenameId !== undefined && raw.id !== filenameId) issue(`id must match filename ${filenameId}.json`);
  const title = string(raw.title, "title", 200), question = string(raw.question, "question", 2000);
  if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 9)
    issue("options must contain 1–9 choices");
  const used = new Set<string>();
  const options: DecisionOption[] = raw.options.map((entry, i) => {
    if (!object(entry)) issue(`options[${i}] must be an object`);
    if (!KEY.test(String(entry.key ?? ""))) issue(`options[${i}].key must be 1–40 letters, digits, - or _`);
    const key = entry.key as string;
    if (used.has(key)) issue(`duplicate option key: ${key}`);
    used.add(key);
    const label = string(entry.label, `options[${i}].label`, 140);
    if (entry.images !== undefined && (!Array.isArray(entry.images) || entry.images.length > 12))
      issue(`options[${i}].images must be an array of at most 12 paths`);
    const images = entry.images === undefined ? undefined : (entry.images as unknown[]).map((p) => relPath(p));
    const detail = entry.detail === undefined ? undefined : string(entry.detail, `options[${i}].detail`, 2500);
    return { key, label, ...(images === undefined ? {} : { images }), ...(detail === undefined ? {} : { detail }) };
  });
  if (typeof raw.allowNote !== "boolean") issue("allowNote must be true or false");
  const createdAt = timestamp(raw.createdAt, "createdAt");
  const deadline = raw.deadline === undefined ? undefined : timestamp(raw.deadline, "deadline");
  return { id: raw.id as string, title, question, options, allowNote: raw.allowNote,
    createdAt, ...(deadline === undefined ? {} : { deadline }) };
}
export function validateAnswer(raw: unknown, decision: Decision): DecisionAnswer {
  if (!object(raw) || typeof raw.key !== "string" || typeof raw.note !== "string")
    issue("answer must contain string key and note");
  const key = raw.key, note = raw.note;
  if (note.length > 500 || note.includes("\0")) issue("answer note must be at most 500 characters");
  if (!decision.allowNote && note.trim()) issue("notes are disabled for this decision");
  // Owner 27 Nov: "some decisions I have nothing to say to": "dismissed" is always allowed and means drop the question.
  if (key === "dismissed") return { key, note: note.trim() && decision.allowNote ? note : "", at: timestamp(raw.at, "answer.at") };
  if (key && !decision.options.some((o) => o.key === key)) issue(`answer key is not an option: ${key}`);
  if (!key && (!decision.allowNote || !note.trim())) issue("choose an option or enter a note");
  return { key, note, at: timestamp(raw.at, "answer.at") };
}
const inside = (base: string, target: string): boolean => {
  const rel = path.relative(base, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
};
const real = (file: string) => realpathSync.native(file);
const samePath = (a: string, b: string) => process.platform === "win32"
  ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
  : path.normalize(a) === path.normalize(b);
const regularFile = (file: string): void => {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) issue("symlinks/junctions or non-files are not allowed");
};
/** A ray must be on rays.txt and physically inside the configured root, even through junctions. */
export function rayFolder(root: string, ray: string, allowUnlisted = false): string {
  if (!RAY.test(ray) || (!allowUnlisted && !projectNames(root).includes(ray))) throw new DecisionError(404, "ray is not listed in rays.txt");
  let base: string, folder: string;
  try { base = real(root); folder = real(path.join(root, ray)); }
  catch { throw new DecisionError(404, "ray folder not found"); }
  if (!inside(base, folder) || !statSync(folder).isDirectory()) issue("ray folder escapes rays root");
  return folder;
}
function decisionDir(folder: string, area: "pending" | "answered", create = false): string {
  const target = path.join(folder, "decisions", area);
  if (create) {
    const parent = path.join(folder, "decisions");
    if (!existsSync(parent)) mkdirSync(parent);
    if (!samePath(real(parent), parent) || !statSync(parent).isDirectory()) issue("decisions directory is redirected");
    if (!existsSync(target)) mkdirSync(target);
  }
  const targetReal = real(target);
  if (!samePath(targetReal, target) || !inside(folder, targetReal) || !statSync(targetReal).isDirectory() ||
    path.relative(folder, targetReal).split(path.sep)[0] !== "decisions")
    issue("decisions directory escapes the ray");
  return targetReal;
}
function legacyRecord(file: string, folder: string, value: unknown): unknown {
  return path.dirname(file) === path.join(folder,"decisions") && object(value) ? {allowNote:false,createdAt:statSync(file).mtime.toISOString(),...value} : value;
}
function readJson(file: string): unknown {
  regularFile(file);
  if (statSync(file).size > MAX_JSON_BYTES) issue("JSON file exceeds 128 KiB");
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { issue(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`); }
}
function imageType(ext: string, buf: Buffer): boolean {
  if (ext === ".png") return buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === ".jpg" || ext === ".jpeg") return buf[0] === 255 && buf[1] === 216 && buf[2] === 255;
  if (ext === ".gif") return buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a";
  if (ext === ".webp") return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  if (ext === ".avif") return buf.toString("ascii", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(buf.toString("ascii", 8, 12));
  return false;
}
/** Check extension, magic bytes, byte cap and real path. SVG/HTML and junction escapes are refused. */
export function safeImage(folder: string, input: string): { file: string; mime: string; size: number } {
  const relative = relPath(input);
  const ext = path.extname(relative).toLowerCase(), mime = MIME[ext];
  if (!mime) issue("unsupported image type (use PNG, JPEG, GIF, WebP or AVIF)");
  const full = path.resolve(folder, ...relative.split("/"));
  if (!inside(folder, full)) issue("image path escapes ray");
  let target: string;
  try { target = real(full); } catch { throw new DecisionError(404, `image not found: ${relative}`); }
  // Compare real to real: Windows temp paths can be 8.3 short names (GALAXY~1) that realpath expands.
  let root: string;
  try { root = real(folder); } catch { throw new DecisionError(404, "ray folder not found"); }
  if (!inside(root, target)) issue("image junction/symlink escapes ray");
  const st = statSync(target);
  if (!st.isFile()) issue("image is not a file");
  if (st.size > MAX_IMAGE_BYTES) throw new DecisionError(413, "image exceeds 8 MiB");
  if (st.size < 12) issue("image is too short");
  const fd = openSync(target, "r");
  const magic = Buffer.alloc(16);
  try { readSync(fd, magic, 0, magic.length, 0); } finally { closeSync(fd); }
  if (!imageType(ext, magic)) issue("image content does not match its file extension");
  return { file: target, mime, size: st.size };
}
function answerFile(dir: string, id: string): string { return path.join(dir, `${id}.answer.json`); }
function parseItem(folder: string, area: "pending" | "answered", id: string, raw: unknown): Decision {
  const decision = validateDecision(raw, id);
  for (const opt of decision.options) for (const rel of opt.images ?? []) {
    try { safeImage(folder, rel); }
    catch (e) { issue(`option ${opt.key} image ${rel}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return decision;
}

type Cached = { mtimeMs: number; ctimeMs: number; size: number; value?: Decision; error?: string };
export class DecisionService {
  private files = new Map<string, Cached>();
  private tokens = new Map<string, number>();
  readonly root: string;
  private readonly clock: () => number;
  constructor(root: string, clock: () => number = Date.now) { this.root = root; this.clock = clock; }
  issueToken(): string {
    const now = this.clock();
    for (const [token, expires] of this.tokens) if (expires < now) this.tokens.delete(token);
    while (this.tokens.size >= 512) this.tokens.delete(this.tokens.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, now + 2 * 3600_000);
    return token;
  }
  hasToken(token: string): boolean { return typeof token === "string" && (this.tokens.get(token) ?? 0) >= this.clock(); }
  private getDecision(file: string, folder: string, area: "pending" | "answered", id: string): Cached {
    const st = statSync(file);
    const cached = this.files.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs && cached.size === st.size) return cached;
    const entry: Cached = { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size };
    try { entry.value = parseItem(folder, area, id, legacyRecord(file, folder, readJson(file))); }
    catch (e) { entry.error = e instanceof Error ? e.message : String(e); }
    this.files.set(file, entry);
    return entry;
  }
  list(only?: readonly string[], ids?: readonly string[]): InboxItem[] {
    const items: InboxItem[] = [], present = new Set<string>();
    for (const ray of only ?? projectNames(this.root)) {
      let folder: string;
      try { folder = rayFolder(this.root, ray, !!only); }
      catch (e) { items.push({ ray, id: "folder", folder: "pending", state: "error", error: (e as Error).message }); continue; }
      const cards = new Map<string, NonNullable<InboxItem["card"]>>();
      try {
        const goals = path.join(folder, "GOALS.md");
        regularFile(goals);
        for (const r of parseRpm(readFileSync(goals, "utf8"), ray).results)
          for (const c of r.steps) if (c.decision && !cards.has(c.decision))
            cards.set(c.decision, { result: r.id, index: c.index, text: c.text });
      } catch {}
      for (const area of ["pending", "answered", "legacy"] as const) {
        let dir: string;
        try { dir = area === "legacy" ? path.join(folder,"decisions") : decisionDir(folder, area);
          if (area === "legacy" && (!existsSync(dir) || !samePath(real(dir),dir))) continue; }
        catch (e) {
          // A missing decisions folder is normal on rays that have not used this feature.
          if (!existsSync(path.join(folder, "decisions", area))) continue;
          items.push({ ray, id: "folder", folder: area === "legacy" ? "pending" : area, state: "error", error: (e as Error).message }); continue;
        }
        let names: string[];
        try { names = readdirSync(dir); }
        catch (e) { items.push({ ray, id: "folder", folder: area === "legacy" ? "pending" : area, state: "error",
          error: `cannot list decisions: ${e instanceof Error ? e.message : String(e)}` }); continue; }
        for (const name of names.filter((n) => n.endsWith(".answer.json") &&
          !names.includes(n.slice(0, -12) + ".json")))
          items.push({ ray, id: name.slice(0, -12), folder: area === "legacy" ? "pending" : area, state: "error",
            error: "orphan answer.json (matching decision .json is missing)" });
        for (const name of names.filter((n) => n.endsWith(".json") && !n.endsWith(".answer.json"))) {
          const id = name.slice(0, -5), file = path.join(dir, name);
          if (ids && !ids.includes(id)) continue;
          present.add(file);
          const item: InboxItem = { ray, id, folder: area === "legacy" ? "pending" : area, state: "error", ...(cards.has(id) ? { card: cards.get(id) } : {}) };
          try {
            if (!ID.test(id)) issue("invalid decision filename");
            const parsed = this.getDecision(file, folder, area === "legacy" ? "pending" : area, id);
            if (parsed.error || !parsed.value) issue(parsed.error ?? "invalid decision");
            item.decision = parsed.value;
            const ans = answerFile(dir, id);
            if (existsSync(ans)) item.answer = validateAnswer(readJson(ans), parsed.value);
            item.state = item.answer || area === "answered" ? "answered" : "pending";
            if (area === "answered" && !item.answer) issue("archived decision is missing its answer.json");
          } catch (e) { item.error = e instanceof Error ? e.message : String(e); }
          items.push(item);
        }
      }
    }
    for (const f of this.files.keys()) if (!present.has(f)) this.files.delete(f);
    return items.sort((a, b) => {
      const rank = (x: InboxItem) => x.state === "pending" ? 0 : x.state === "error" ? 1 : 2;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const aTime = Date.parse(a.decision?.createdAt ?? "") || 0;
      const bTime = Date.parse(b.decision?.createdAt ?? "") || 0;
      return a.state === "answered" ? bTime - aTime : aTime - bTime;
    });
  }
  summary(list: InboxItem[] = this.list()) {
    const pending = list.filter((x) => x.state === "pending");
    const oldest = pending.length ? pending.reduce((earliest, x) =>
      Math.min(earliest, Date.parse(x.decision!.createdAt)), Number.POSITIVE_INFINITY) : null;
    return { pending: pending.length, errors: list.filter((x) => x.state === "error").length,
      oldestAgeMs: oldest === null ? null : Math.max(0, this.clock() - oldest) };
  }
  answer(ray: string, id: string, key: string, note: string, change = false, allowUnlisted = false): DecisionAnswer {
    if (!ID.test(id)) issue("invalid decision id");
    const folder = rayFolder(this.root, ray, allowUnlisted);
    const legacy = path.join(folder,"decisions");
    const dir = existsSync(path.join(legacy, "pending", `${id}.json`)) ? decisionDir(folder,"pending") : samePath(real(legacy),legacy) ? legacy : decisionDir(folder,"pending");
    const file = path.join(dir, `${id}.json`);
    if (!existsSync(file)) throw new DecisionError(404, "pending decision not found");
    const decision = parseItem(folder, "pending", id, legacyRecord(file, folder, readJson(file)));
    const answer = validateAnswer({ key, note, at: new Date(this.clock()).toISOString() }, decision);
    const dest = answerFile(dir, id);
    if (!change && existsSync(dest)) throw new DecisionError(409, "already answered; click change answer first");
    if (change && !existsSync(dest)) throw new DecisionError(409, "no answer to change");
    const tmp = path.join(dir, `.${id}.${randomBytes(12).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(answer, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
      if (change) renameSync(tmp, dest);
      else linkSync(tmp, dest); // exclusive atomic publication, unlike an overwrite-prone rename
    } catch (e) {
      if (object(e) && e.code === "EEXIST") throw new DecisionError(409, "already answered; click change answer first");
      throw e;
    } finally { try { unlinkSync(tmp); } catch {} }
    return answer;
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const allowedHost = (hostname: string, configuredHost: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", [127,0,0,1].join("."), "::1"].includes(host) ||
    (configuredHost !== [0,0,0,0].join(".") && host === configuredHost.toLowerCase())) return true;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/.test(host)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!ip && Number(ip[1]) === 100 && Number(ip[2]) >= 64 && Number(ip[2]) <= 127 &&
    Number(ip[3]) <= 255 && Number(ip[4]) <= 255;
};
/** Fail closed for missing/mismatched Origin, Host, Fetch-Site or page token. */
export function authorizeDecisionPost(req: Request, url: URL, service: DecisionService, host: string): boolean {
  const origin = req.headers.get("origin"), headerHost = req.headers.get("host");
  const site = req.headers.get("sec-fetch-site");
  // Tailscale Serve terminates HTTPS before forwarding to local HTTP. Origin retains HTTPS.
  const forwardedHttps = url.protocol === "http:" && url.hostname.toLowerCase().endsWith(".ts.net") &&
    origin === `https://${url.host}`;
  // Some Tailscale Serve proxies rewrite Host to the localhost upstream. In that case
  // cross-check the original Host and scheme provided by the proxy against Origin.
  const forwardedHost = req.headers.get("x-forwarded-host") ?? "";
  const proxyOrigin = /^([a-z0-9-]+\.)+ts\.net(?::\d{1,5})?$/i.test(forwardedHost) &&
    req.headers.get("x-forwarded-proto") === "https" && origin === `https://${forwardedHost}`;
  return !!origin && (origin === url.origin || forwardedHttps || proxyOrigin) && !!headerHost && headerHost.toLowerCase() === url.host.toLowerCase() &&
    allowedHost(url.hostname, host) && (!site || site === "same-origin" || site === "none") &&
    service.hasToken(req.headers.get("x-decision-token") ?? "");
}
export async function handleDecisionsApi(req: Request, url: URL, service: DecisionService,
  host = [127,0,0,1].join("."), remoteAddress?: string): Promise<Response | null> {
  if (url.pathname === "/api/decisions" && req.method === "GET") {
    const items = service.list();
    return json({ items, summary: service.summary(items) });
  }
  if (url.pathname === "/api/decisions/image" && req.method === "GET") {
    try {
      const ray = url.searchParams.get("ray") ?? "", file = url.searchParams.get("path") ?? "";
      const image = safeImage(rayFolder(service.root, ray), file);
      return new Response(readFileSync(image.file), { headers: {
        "content-type": image.mime, "content-length": String(image.size), "cache-control": "private, max-age=30",
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
      } });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof DecisionError ? e.status : 404); }
  }
  if (url.pathname === "/api/decisions/answer") {
    if (req.method !== "POST") return json({ error: "POST_required" }, 405);
    if ((remoteAddress !== undefined && ![[127,0,0,1].join("."), "::1", ("::ffff:" + [127,0,0,1].join("."))].includes(remoteAddress)) || !authorizeDecisionPost(req, url, service, host)) return json({ error: "invalid_origin_host_or_page_token" }, 403);
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "JSON_required" }, 415);
    const bodyText = await req.text();
    if (Buffer.byteLength(bodyText) > 4096) return json({ error: "request too large" }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!object(body) || typeof body.ray !== "string" || typeof body.id !== "string" ||
      typeof body.key !== "string" || typeof body.note !== "string" ||
      (body.change !== undefined && typeof body.change !== "boolean"))
      return json({ error: "ray, id, key, note and optional boolean change required" }, 400);
    try {
      const answer = service.answer(body.ray, body.id, body.key, body.note, body.change === true);
      return json({ answer });
    }
    catch (e) { return json({ error: e instanceof Error ? e.message : "answer failed" }, e instanceof DecisionError ? e.status : 500); }
  }
  return null;
}

/** API-independent CLI. Ray path must already exist; it creates only decisions/pending and a JSON file. */
export function ask(rayDir: string, title: string, question: string, options: DecisionOption[], allowNote = true,
  deadline?: string, cardPrefix?: string): Decision {
  const folder = real(rayDir);
  if (!statSync(folder).isDirectory()) issue("rayDir must be a directory");
  const dir = decisionDir(folder, "pending", true);
  const id = `d-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}-${randomBytes(5).toString("hex")}`;
  const decision = validateDecision({ id, title, question, options, allowNote, createdAt: new Date().toISOString(),
    ...(deadline ? { deadline } : {}) });
  for (const opt of decision.options) for (const img of opt.images ?? []) safeImage(folder, img);
  const goals = path.join(folder, "GOALS.md");
  let original: string | undefined, updated: string | undefined;
  if (cardPrefix !== undefined) {
    regularFile(goals);
    original = readFileSync(goals, "utf8");
    updated = linkStepDecision(original, cardPrefix, id);
  }
  const dest = path.join(dir, `${id}.json`);
  writeFileSync(dest, JSON.stringify(decision, null, 2) + "\n", { flag: "wx" });
  if (updated !== undefined) {
    const tmp = path.join(folder, `.GOALS-${randomBytes(12).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, updated, { flag: "wx" });
      regularFile(goals);
      if (readFileSync(goals, "utf8") !== original) issue("GOALS.md changed; retry ask");
      renameSync(tmp, goals);
    } catch (e) { unlinkSync(dest); throw e; }
    finally { try { unlinkSync(tmp); } catch {} }
  }
  return decision;
}
export function wait(rayDir: string, id: string): DecisionAnswer | null {
  if (!ID.test(id)) issue("invalid decision id");
  const folder = real(rayDir);
  const area = existsSync(path.join(folder, "decisions", "pending", `${id}.json`)) ? "pending" : "answered";
  const dir = decisionDir(folder, area);
  const decision = validateDecision(readJson(path.join(dir, `${id}.json`)), id);
  const file = answerFile(dir, id);
  return existsSync(file) ? validateAnswer(readJson(file), decision) : null;
}
export function runDecisionsCli(argv: string[]): number {
  const [action, rayDir, ...args] = argv;
  try {
    if (action === "ask" && rayDir) {
      let title = "", question = "", allowNote = true, deadline: string | undefined, card: string | undefined;
      const options: DecisionOption[] = [];
      for (let i = 0; i < args.length; i++) {
        const flag = args[i], val = args[i + 1];
        if (!val) issue(`missing value after ${flag}`);
        if (flag === "--title") title = val;
        else if (flag === "--question") question = val;
        else if (flag === "--deadline") deadline = val;
        else if (flag === "--card") card = val;
        else if (flag === "--allow-note") {
          if (!["true", "false"].includes(val)) issue("--allow-note must be true or false");
          allowNote = val === "true";
        } else if (flag === "--option") {
          const eq = val.indexOf("="), colon = val.indexOf(":", eq + 1);
          if (eq <= 0) issue("--option must be key=label[:img1,img2]");
          const key = val.slice(0, eq), label = val.slice(eq + 1, colon < 0 ? undefined : colon);
          const images = colon < 0 ? undefined : val.slice(colon + 1).split(",");
          options.push({ key, label, ...(images ? { images } : {}) });
        } else issue(`unknown flag: ${flag}`);
        i++;
      }
      const created = ask(rayDir, title, question, options, allowNote, deadline, card);
      process.stdout.write(`${created.id}\n`);
      return 0;
    }
    if (action === "wait" && rayDir && args.length === 1) {
      const answer = wait(rayDir, args[0]!);
      if (!answer) { process.stderr.write("pending\n"); return 2; }
      process.stdout.write(JSON.stringify(answer) + "\n");
      return 0;
    }
    process.stderr.write('Usage: bun src/decisions.ts ask <rayDir> --title "..." --question "..." --option key=label[:img1,img2] [--option ...] [--allow-note true|false] [--deadline ISO] [--card "card text prefix"]\n       bun src/decisions.ts wait <rayDir> <id>\n');
    return 2;
  } catch (e) {
    process.stderr.write(`decisions: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runDecisionsCli(process.argv.slice(2));
