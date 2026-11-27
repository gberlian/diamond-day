/** A narrow lazy route: resolve only jobs already present in the authoritative ledger summary. */
import { readLedger } from "./ledger-reader.ts";
import { applyCommitEvidence } from "./commit-match.ts";
import { ledgerRay } from "./goals.ts";
import { loadHandoffDetail, writeOff } from "./handoff-detail.ts";
import type { BoardConfig } from "./config.ts";
import { rayNames } from "./domain/fsreader.ts";
const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const result = (value: object, status = 200) => Response.json(value, { status, headers: noStore });
export async function handleHandoffPanelsApi(req: Request, config: BoardConfig): Promise<Response | null> {
  const url = new URL(req.url);
  const match = /^\/api\/board\/rays\/([^/]+)\/handoffs\/([^/]+)(\/writeoff)?$/.exec(url.pathname);
  if (!match) return null;
  const writing = Boolean(match[3]);
  if (req.method !== (writing ? "POST" : "GET")) return result({ error: "method_not_allowed" }, 405);
  let ray: string, name: string;
  try { ray = decodeURIComponent(match[1]!); name = decodeURIComponent(match[2]!); }
  catch { return result({ error: "bad_encoding" }, 400); }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ray) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
    return result({ error: "invalid_ray_or_job" }, 400);
  if (!rayNames(config.raysRoot).includes(ray)) return result({ error: "ray_not_found" }, 404);
  const demo = process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true";
  if (writing) {
    if (demo || !config.actions) return result({ error: "actions_disabled" }, 403);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return result({ error: "cross_origin_denied" }, 403);
    if (req.headers.get("sec-fetch-site") === "cross-site") return result({ error: "cross_origin_denied" }, 403);
    if (!req.headers.get("content-type")?.startsWith("application/json")) return result({ error: "json_required" }, 415);
  }
  if (!config.integrations.ledger.enabled && !process.env.RAY_BOARD_LEDGER_FIXTURE)
    return result({ error: "ledger_disabled" }, 404);
  const ledger = await readLedger(config.raysRoot, Date.now(), config.integrations.ledger.path);
  if (!ledger.jobs.length && ledger.error) return result({ error: ledger.error }, 503);
  const job = applyCommitEvidence(config.raysRoot, ray,
    ledger.jobs.filter(j => j.name === name && ledgerRay(j)?.toLowerCase() === ray.toLowerCase()))[0];
  if (!job) return result({ error: "handoff_not_found" }, 404);
  try {
    if (writing) {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.reason !== "string") return result({ error: "reason_required" }, 400);
      if (!["done", "unapplied-late", "failed", "done-zip-missing"].includes(job.state))
        return result({ error: "only_completed_unapplied_handoffs_may_be_written_off" }, 409);
      writeOff(config.raysRoot, ray, name, body.reason, job.queueDir);
      return result({ state: "superseded", reason: body.reason.trim() });
    }
    return result(await loadHandoffDetail(config.raysRoot, ray, job, config, { demo }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const exists = (e as NodeJS.ErrnoException).code === "EEXIST";
    return result({ error: exists ? "marker_already_exists" : message }, exists ? 409 : /reason|outside|unsafe|invalid/.test(message) ? 400 : 502);
  }
}
