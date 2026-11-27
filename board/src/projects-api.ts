import { cardTabs, cardCheck, sourcePreview } from "./card-modal.ts";
/** Routes for the projects list (/board/projects) and one project's page (/board/p/<ray>). Reads are open
 * to the shared read-only proxy; every write needs the local write guard and a loopback host. */
import type { BoardConfig } from "./config.ts";
import { writeGuard, loopback, editingEnabled } from "./goal-write.ts";
import { readLedger } from "./ledger-reader.ts";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjects, projectDetail, projectRays, createProject, writeGoals, jobTexts, validRayName, syncProject, type SessionInfo } from "./projects.ts";
import { makeRayCard } from "./ray-goals-api.ts";
import { EditError, newProjectFiles, setHeader, setResultField, setStepText, setStepMark, addStep, addResult, reorderResults, type Mark, parseRpm } from "./rpm.ts";
import { artifactResponse, returnedArtifacts, localJobGuard, rescueJob, readFleetLimit, setFleetLimit, writeFloor, validLimit, validFleetLimit, safeArtifact, artifactHref, queueAttachments } from "./project-arpe.ts";
import { overlayDiff } from "./diff-page.ts";
import { parseUnifiedDiff, renderDiffHtml } from "./diff-view.ts";
import { readShelf } from "./shelf-reader.ts";
import { loadHandoffDetail } from "./handoff-detail.ts";
import { DecisionService, safeImage } from "./decisions.ts";
import { renderDoc, safeUnder, serveDocAsset, DOC_STYLE } from "./docs-page.ts";
import { builtPdf } from "./library.ts";
import { projectsPage, projectPage } from "./projects-page.ts";
import { parseGoals, readRayGoals } from "./goals.ts";
import { CheckService } from "./checks.ts";
import { EDIT_LOG, type OwnerEdit } from "./edits-summary.ts";

const noStore = { "cache-control": "no-store" };
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: noStore });
const html = (s: string) => new Response(s, { headers: { "content-type": "text/html; charset=utf-8", ...noStore } });
const str = (v: unknown, max = 4096) => (typeof v === "string" && v.length <= max && !v.includes("\0") ? v : null);

async function ledger(config: BoardConfig) {
  return config.integrations.ledger.enabled
    ? readLedger(config.raysRoot, Date.now(), config.integrations.ledger.path) : { jobs: [], error: null };
}

/** Apply one edit operation from the page to a GOALS.md text. */
export function applyEdit(md: string, body: Record<string, unknown>): string {
  const id = str(body.id, 8) ?? "";
  const index = Number(body.index);
  const text = str(body.text);
  switch (body.op) {
    case "header": {
      const key = body.key;
      if (key !== "vision" && key !== "purpose" && key !== "roles" || text == null) throw new EditError("bad header edit");
      return setHeader(md, key, text);
    }
    case "result": {
      const key = body.key;
      if (!["title", "result", "purpose", "now"].includes(String(key)) || text == null || !/^\d+$/.test(id)) throw new EditError("bad result edit");
      return setResultField(md, id, key as "title", text);
    }
    case "step":
      if (text == null || !Number.isInteger(index)) throw new EditError("bad step edit");
      return setStepText(md, id, index, text);
    case "mark":
      if (!Number.isInteger(index) || ![" ", "x", "~"].includes(String(body.mark))) throw new EditError("bad mark");
      return setStepMark(md, id, index, body.mark as Mark);
    case "add-step":
      if (text == null) throw new EditError("bad step");
      return addStep(md, id, text);
    case "add-result":
      if (text == null) throw new EditError("bad result");
      return addResult(md, text);
    case "order":
      if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === "string" && /^\d+$/.test(x))) throw new EditError("bad order");
      return reorderResults(md, body.ids as string[]);
    default: throw new EditError("unknown op");
  }
}

export async function handleProjects(req: Request, config: BoardConfig, running: string[],
  sessions: () => Promise<Record<string, SessionInfo>>, remoteAddress?: string, decisions = new DecisionService(config.raysRoot), checkService?: CheckService): Promise<Response | null> {
  const url = new URL(req.url), p = url.pathname;
  const canEdit = editingEnabled(config) && loopback(req) && (remoteAddress === undefined || [[127,0,0,1].join("."),"::1",("::ffff:" + [127,0,0,1].join("."))].includes(remoteAddress));
  const fleetLimit = config.integrations.ledger.enabled ? readFleetLimit(config) : null;
  if (!config.integrations.ledger.enabled && (/^\/api\/board\/fleet\//.test(p) || /^\/api\/board\/project\/[^/]+\/(job|floor|job-diff|rescue)(?:\/|$)/.test(p))) return json({error:"integration_disabled"},404);
  if (!config.integrations.restarter.enabled && p === "/api/board/restarter/context") return json({error:"integration_disabled"},404);
  if (p === "/api/board/folders") return json({error:"integration_disabled"},404);
  // Owner 26 Nov: "why dont we have context size in board settings": the context size at which the restarter
  // hands a session over to a fresh one, stored in the restarter's own config (read on every pass).
  if (p === "/api/board/restarter/context") {
    const file = path.join(process.env.RAY_RESTARTS_DIR ?? path.join(os.homedir(), ".ray-restarts"), "config.json");
    let cfg: Record<string, unknown> = {}; try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch {}
    if (req.method === "GET") return json({ ctxMax: typeof cfg.ctxMax === "number" ? cfg.ctxMax : 400_000 });
    const denied = localJobGuard(req, config, remoteAddress); if (denied) return denied;
    const b = await req.json().catch(() => null);
    const k = Number(b?.ctxMax);
    if (!Number.isInteger(k) || k < 100_000 || k > 1_000_000) return json({ error: "context size must be 100k–1000k" }, 400);
    try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ ...cfg, ctxMax: k }, null, 2)); return json({ ok: true }); }
    catch { return json({ error: "could not write restarter config" }, 500); }
  }
  if (p === "/api/board/folders") {
    // Owner 27 Nov: where new rays and new repos go; same file as `arpe settings`.
    const { readSettings, writeSettings, DEFAULTS } = await import("./settings.ts");
    if (req.method === "GET") { const s = readSettings() ?? {}; return json({ raysRoot: s.raysRoot ?? DEFAULTS.raysRoot, codeRoot: s.codeRoot ?? DEFAULTS.codeRoot }); }
    const denied = localJobGuard(req, config, remoteAddress); if (denied) return denied;
    const b = await req.json().catch(() => null);
    try { writeSettings({ ...(b?.raysRoot ? { raysRoot: String(b.raysRoot) } : {}), ...(b?.codeRoot ? { codeRoot: String(b.codeRoot) } : {}) }); return json({ ok: true }); }
    catch (e: any) { return json({ error: e?.message ?? "could not save folders" }, 400); }
  }
  if (p === "/api/board/fleet/jobs") {
    const denied = localJobGuard(req, config, remoteAddress); if (denied) return denied;
    const b = await req.json().catch(() => null);
    if (!validFleetLimit(b?.limit)) return json({ error: "jobs at once must be 1–40" }, 400);
    try { await setFleetLimit(config, b.limit); return json({ ok: true }); }
    catch { return json({ error: "Fleet setting or restart failed; verify config and keeper status" }, 502); }
  }
  const rescue = /^\/api\/rays\/([\w.-]+)\/jobs\/([\w.-]+)\/rescue$/.exec(p);
  if (rescue) {
    const denied = localJobGuard(req, config, remoteAddress); if (denied) return denied;
    const [, ray, name] = rescue;
    if (!validRayName(ray!) || !projectRays(config.raysRoot).includes(ray!) || !validRayName(name!)) return json({ error: "invalid ray or job" }, 404);
    const led = await ledger(config);
    const job = makeRayCard(config.raysRoot, ray!, led.jobs, led.error).groups.flatMap(g => g.jobs).find(j => j.name === name);
    if (!job) return json({ error: led.error || "job not found" }, led.error ? 503 : 404);
    return rescueJob(req, config, remoteAddress, ray!, job);
  }
  if (p === "/board/projects" && req.method === "GET") return html(projectsPage());
  const page = /^\/board\/p\/([^/]+)$/.exec(p);
  if (page && req.method === "GET") {
    const ray = decodeURIComponent(page[1]!);
    if (!validRayName(ray) || !projectRays(config.raysRoot).includes(ray)) return new Response("not found", { status: 404 });
    return html(projectPage(ray, decisions.issueToken()));
  }
  if (p === "/api/board/projects") {
    if (req.method === "GET")
      return json({ projects: listProjects(config.raysRoot, running, await sessions()), editEnabled: canEdit, fleetLimit });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const denied = writeGuard(req, config, true);
    if (denied) return denied;
    if (remoteAddress !== undefined && !canEdit) return json({ error: "local only" }, 403);
    const b = await req.json().catch(() => null) as Record<string, unknown> | null;
    const name = str(b?.name, 64)?.trim() ?? "";
    if (!validRayName(name)) return json({ error: "name: letters, digits, - . _" }, 400);
    try {
      createProject(config.raysRoot, name, newProjectFiles(name, str(b?.vision) ?? "", str(b?.purpose) ?? "", str(b?.roles) ?? ""));
    } catch (e) { return json({ error: String((e as Error).message) === "exists" ? "exists" : "create failed" }, 409); }
    return json({ ok: true, ray: name, href: `/board/p/${encodeURIComponent(name)}` });
  }
  const api = /^\/api\/board\/project\/([^/]+)(?:\/(edit|job|floor|artifact|job-diff|doc|doc-asset|decision|decision-image|card)(?:\/([^/]+))?)?$/.exec(p);
  if (!api) return null;
  let ray: string, job: string | null;
  try { ray = decodeURIComponent(api[1]!); job = api[3] ? decodeURIComponent(api[3]) : null; }
  catch { return json({ error: "invalid encoding" }, 400); }
  if (!validRayName(ray) || !projectRays(config.raysRoot).includes(ray)) return json({ error: "no such project" }, 404);
  if (api[2] === "card") {
    if (req.method !== "GET") return json({ error: "GET required" }, 405);
    const result = url.searchParams.get("result") ?? "", step = url.searchParams.get("step") ?? "";
    if (!/^\d{1,12}$/.test(result) || !/^\d{1,8}$/.test(step)) return json({ error: "invalid result or step" }, 400);
    const file = safeArtifact(config.raysRoot, ray, "GOALS.md");
    if (!file) return json({ error: "card not found" }, 404);
    const md = readFileSync(file, "utf8"), goal = parseGoals(md, ray).goals.find(g => g.id === result);
    const card = parseRpm(md, ray).results.find(r => r.id === result)?.steps.find(c => c.index === Number(step));
    if (!goal || !card) return json({ error: "card not found" }, 404);
    const tabs = cardTabs(ray, card.proofs, config.raysRoot);
    const view = url.searchParams.get("view");
    if (view === "check") {
      const demo = process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true";
      const service = checkService ?? new CheckService(config.raysRoot, config.dataDir, Date.now, demo);
      return json(cardCheck(config.raysRoot, ray, config.codeRoot, goal, service, demo));
    }
    if (view === "source") {
      const index = url.searchParams.get("tab") ?? "";
      const tab = /^\d{1,8}$/.test(index) ? tabs[Number(index)] : undefined;
      if (tab?.kind !== "file" || tab.preview !== "code" || !tab.path || (url.searchParams.has("path") && url.searchParams.get("path") !== tab.path)) return json({error:"source not found"},404);
      const target = safeArtifact(config.raysRoot, ray, tab.path);
      if (!target) return json({error:"source not found"},404);
      try { const source = sourcePreview(target, 2000); return source ? json(source) : json({error:"binary source"},415); }
      catch { return json({error:"source unavailable"},404); }
    }
    if (view) return json({error:"unknown view"},400);
    return json({ result, step: card.index, title: card.text, mark: card.mark, proofs: card.proofs, tabs });
  }
  if (api[2] === "doc" || api[2] === "doc-asset") {
    if (req.method !== "GET") return json({error:"GET required"},405);
    const relative = url.searchParams.get("path") ?? "";
    const prefix = ray + "/";
    const base = safeUnder(config.raysRoot, ray);
    if (!base || !relative.startsWith(prefix) || !safeUnder(base, relative.slice(prefix.length)))
      return json({error:"document not found"},404);
    if (api[2] === "doc-asset") return serveDocAsset(config.raysRoot, relative);
    if (url.searchParams.get("pdf") === "1") {
      const pdf = builtPdf(base, relative.slice(prefix.length));
      if (pdf && safeArtifact(config.raysRoot, ray, pdf)) return artifactResponse(config.raysRoot, ray, pdf);
    }
    const standalone = ["view", "print", "pdf"].some(key => url.searchParams.get(key) === "1");
    return renderDoc(config.raysRoot, relative, !standalone, ray);
  }
  if (api[2] === "decision-image") {
    if (req.method !== "GET") return json({error:"GET required"},405);
    try {
      const image = safeImage(path.join(config.raysRoot, ray), url.searchParams.get("path") ?? "");
      return new Response(readFileSync(image.file), {headers:{"content-type":image.mime,"x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
    } catch { return json({error:"image not found"},404); }
  }
  if (api[2] === "decision") {
    if (req.method !== "GET") return json({error:"GET required"},405);
    const item = decisions.list().find(x => x.ray === ray && x.id === url.searchParams.get("id"));
    if (!item?.decision) return json({error:"decision not found"},404);
    const d = item.decision;
    const esc = (v: string) => v.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
    const imageUrl = (img: string) => `/api/board/project/${encodeURIComponent(ray)}/decision-image?path=${encodeURIComponent(img)}`;
    const answer = item.answer ? `<p><strong>Answered:</strong> ${esc(d.options.find(o => o.key === item.answer!.key)?.label ?? item.answer.key)} ${esc(item.answer.note)}</p>` : "";
    return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.title)}</title><style>:root{--ink:#0E1621;--row:#132033;--rule:#22344A;--text:#E3EAF2;--soft:#B6C3D1}body{background:var(--ink);color:var(--text)}${DOC_STYLE}@media print{body{background:white;color:black}.board-document,.board-document p,.board-document li,.board-document strong{color:black}}</style></head><body><article class="board-document"><h1>${esc(d.title)}</h1><p>${esc(d.question)}</p>${answer}<ul>${d.options.map(o => `<li><strong>${esc(o.label)}</strong>${o.detail ? `<p>${esc(o.detail)}</p>` : ""}${(o.images ?? []).map(img => `<img alt="${esc(o.label)}" src="${esc(imageUrl(img))}">`).join("")}</li>`).join("")}</ul></article>${url.searchParams.get("print") === "1" ? `<script>addEventListener("load",()=>print())</script>` : ""}</body></html>`);
  }
  if (api[2] === "floor") {
    const denied = localJobGuard(req, config, remoteAddress); if (denied) return denied;
    const b = await req.json().catch(() => null);
    if (!validLimit(b?.floor)) return json({ error: "jobs at once must be 1–10" }, 400);
    try { writeFloor(config.raysRoot, ray, b.floor); return json({ ok: true }); }
    catch { return json({ error: "Could not write floor" }, 400); }
  }
  if (api[2] === "artifact" && req.method === "GET") {
    const relative = url.searchParams.get("path") ?? "";
    const detail = projectDetail(config.raysRoot, ray, [], undefined, [], null, false);
    const href = `/api/board/project/${encodeURIComponent(ray)}/artifact?path=${encodeURIComponent(relative)}`;
    const permitted = detail.results.some(r => r.cards.some(c => (c.proofLinks?.some(l => l.href === href) || c.modalTabs?.some(t => t.kind === "file" && t.href === href)))) ||
      /^\.docs\/chatgpt\/small\/zip-[\w.-]+\/files\//.test(relative) ||
      // a document's built PDF (Documents tab and modal); safeArtifact still keeps it inside the ray
      (/\.pdf$/i.test(relative) && !relative.startsWith(".docs/"));
    return permitted ? artifactResponse(config.raysRoot, ray, relative) : json({ error: "artifact not found" }, 404);
  }
  if (api[2] === "edit") {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const denied = writeGuard(req, config, true);
    if (denied) return denied;
    if (remoteAddress !== undefined && !canEdit) return json({ error: "local only" }, 403);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid JSON" }, 400);
    // Browser ownership boundary; retain the existing local programmatic API for agents/tools.
    if ((req.headers.has("origin") || req.headers.has("sec-fetch-site")) &&
        !((body.op === "header" && ["vision","purpose"].includes(body.key)) ||
          (body.op === "result" && ["result","purpose"].includes(body.key))))
      return json({ error: "Execution is owned by the agent; only Result and Purpose are editable here" }, 403);
    let ownerEdit: OwnerEdit | undefined;
    try {
      writeGoals(config.raysRoot, ray, (md) => {
        const updated = applyEdit(md, body as Record<string, unknown>);
        const key = body.key;
        if (body.op === "result" && (key === "result" || key === "purpose")) {
          const id = String(body.id);
          const field = (text: string) => parseGoals(text, ray).goals.find(g => g.id === id)?.[key] ?? "";
          const old = field(md), next = field(updated);
          if (old !== next) ownerEdit = { ts: Date.now(), id, key, old, new: next };
        } else if (body.op === "header" && (key === "vision" || key === "purpose")) {
          const old = parseRpm(md, ray)[key], next = parseRpm(updated, ray)[key];
          if (old !== next) ownerEdit = { ts: Date.now(), scope: "header", key, old, new: next };
        }
        return updated;
      });
    } catch (e) { return json({ error: (e as Error).message }, e instanceof EditError ? e.status : 400); }
    // HEAD has no owner-edit journal yet. Log only committed changes to human-owned fields.
    if (ownerEdit) {
      try { appendFileSync(path.join(config.raysRoot, ray, EDIT_LOG), JSON.stringify(ownerEdit) + "\n", { mode: 0o600 }); }
      catch { return json({ error: "GOALS.md saved, but owner-edit log could not be written" }, 500); }
    }
    return json({ ok: true });
  }
  if (req.method !== "GET") return json({ error: "GET required" }, 405);
  const led = await ledger(config);
  if (api[2] === "job" || api[2] === "job-diff") {
    if (!job || !validRayName(job)) return json({ error: "job required" }, 400);
    const card = makeRayCard(config.raysRoot, ray, led.jobs, led.error);
    const found = card.groups.flatMap((g) => g.jobs).find((j) => j.name === job);
    if (!found) return json({ error: "job not found" }, 404);
    const files = returnedArtifacts(config.raysRoot, ray, job);
    if (api[2] === "job-diff") {
      const diff = await overlayDiff(config.raysRoot, ray, files, config.codeRoot);
      return html(renderDiffHtml({ title: job + " · returned files", meta: [diff.repo ?? ""], message: diff.error ?? "",
        files: parseUnifiedDiff(diff.text ?? ""), raw: diff.text ?? "" }));
    }
    const texts = jobTexts(config.raysRoot, ray, found);
    let attachments = found.attachments?.length ? found.attachments : queueAttachments(config.raysRoot, ray, job);
    if (process.env.RAY_BOARD_KEEPER || (config.integrations.ledger.path && !config.integrations.ledger.path.endsWith(".json"))) {
      try {
        const full = await loadHandoffDetail(config.raysRoot, ray, found, config);
        attachments = full.attachments?.length ? full.attachments : attachments;
      } catch { /* disk request/reply remain available */ }
    }
    const metadata = `.docs/chatgpt/small/zip-${job}/DIFF.md`;
    const marker = safeArtifact(config.raysRoot, ray, `.docs/chatgpt/small/zip-${job}/.applied`);
    const appliedCommit = found.appliedCommit || (marker ? /^[0-9a-f]{7,40}\b/i.exec(readFileSync(marker, "utf8").trim())?.[0] : null);
    const linkedFiles = files.map(({label, href}) => ({label, href}));
    if (safeArtifact(config.raysRoot, ray, metadata)) linkedFiles.unshift({label: "DIFF.md", href: artifactHref(ray, metadata)});
    return json({ ...texts, attachments, appliedCommit, files: linkedFiles,
      overlayLink: files.length ? `/api/board/project/${encodeURIComponent(ray)}/job-diff/${encodeURIComponent(job)}` : null });
  }
  const all = await sessions();
  const keeper = process.env.RAY_BOARD_KEEPER || config.integrations.ledger.path;
  const shelf = config.integrations.ledger.enabled && keeper && !keeper.endsWith(".json")
    ? await readShelf(config.raysRoot, Date.now(), keeper) : null;
  const detail = projectDetail(config.raysRoot, ray, running, all[ray], led.jobs, led.error, canEdit, fleetLimit, shelf?.rays[ray]?.floor ?? null, decisions.list());
  const checks = checkService ?? new CheckService(config.raysRoot, config.dataDir ?? path.join(config.raysRoot, ".checks-data"), Date.now,
    process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true");
  const goals = readRayGoals(config.raysRoot, ray).goals;
  return json({ ...detail, usageEnabled:config.integrations.usageProxy.enabled, results: detail.results.map(r => {
    const goal = goals.find(g => g.id === r.id);
    const checkResult = goal ? checks.light(ray, goal) : null;
    const checkState = checkResult?.state === "pass" || checkResult?.state === "fail" ? checkResult.state : "stale";
    return { ...r, check:goal?.check ?? "", checkState, checkResult };
  }) });
}

/** Every 60 s, write the cards' job-derived columns back into GOALS.md of running rays (owner 25 Nov).
 * Local board only: needs editing on, a loopback host and the live ledger; the shared read-only proxy
 * only forwards GETs, which never write. Each change is logged to stdout and card-sync.log in the data dir. */
export function startCardSync(config: BoardConfig, running: () => string[], every = 60_000): (() => void) | null {
  const local = [[127,0,0,1].join("."), "localhost", "::1"].includes(config.host);
  if (!editingEnabled(config) || !local || process.env.RAY_BOARD_DEMO || !config.integrations.ledger.enabled) return null;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const led = await ledger(config);
      if (led.error || !led.jobs.length) return;
      for (const ray of running()) {
        if (!validRayName(ray) || !projectRays(config.raysRoot).includes(ray)) continue;
        try {
          for (const c of syncProject(config.raysRoot, ray, led.jobs)) {
            const line = `${new Date().toISOString()} card-sync ${c.ray} #${c.result} step ${c.index + 1} [${c.from}] -> [${c.to}] ${c.why} :: ${c.step.slice(0, 80)}`;
            process.stdout.write(line + "\n");
            try { appendFileSync(path.join(config.dataDir, "card-sync.log"), line + "\n"); } catch {}
          }
        } catch (e) { process.stdout.write(`card-sync ${ray} failed: ${(e as Error).message}\n`); }
      }
    } finally { busy = false; }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  return () => clearInterval(timer);
}
