/** /api/open: open only a known job's reply or unpacked zip within its own ray queue. */
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { launchOpen as platformOpen } from "./sources/open-with.ts";
import { loadConfig } from "./config.ts";
import { context, ensureRay, queueDir, readJob, MissingEntity } from "./domain/fsreader.ts";

export type OpenKind = "reply" | "zip";
export type OpenLauncher = (kind: OpenKind, file: string) => Promise<void>;

const validName = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export const launchOpen: OpenLauncher = (kind, file) => platformOpen(kind, file, loadConfig().integrations.openWith);

export async function handleOpenHandoff(
  req: Request, root = context().root, launch: OpenLauncher = launchOpen,
): Promise<Response> {
  if (req.method !== "POST")
    return Response.json({ error: "POST required" }, { status: 405, headers: { allow: "POST" } });
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? ""))
    return Response.json({ error: "JSON required" }, { status: 415 });
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > 8192)
    return Response.json({ error: "request too large" }, { status: 413 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return Response.json({ error: "invalid request" }, { status: 400 });
  const { ray, job, what } = body as Record<string, unknown>;
  if (!validName(ray) || !validName(job) || (what !== "reply" && what !== "zip"))
    return Response.json({ error: "invalid ray, job or action" }, { status: 400 });

  try {
    const ctx = context(root);
    ensureRay(ctx, ray);
    // Checks job membership within this ray's physical queue, not just matching sidecar names.
    const record = readJob(ctx, ray, job);
    const base = queueDir(root, ray);
    const target = what === "reply"
      ? path.join(base, `reply-${job}.md`)
      : path.join(base, `zip-${job}`);
    const expected = what === "reply" ? record.replyPath : record.zipDir;
    if (!expected || path.resolve(expected) !== path.resolve(target))
      return Response.json({ error: "result not found" }, { status: 404 });

    // Enforce containment twice: symlinks must not escape RAYS_ROOT or this ray's queue.
    // Also require the expected file type so a sidecar .zip cannot masquerade as a directory.
    const realRoot = realpathSync(root), realBase = realpathSync(base), realTarget = realpathSync(target);
    const expectedBase = path.join(realRoot, ray, ".docs", "chatgpt", "small");
    if (path.relative(expectedBase, realBase) !== "" ||
        !inside(realRoot, realBase) || !inside(realBase, realTarget))
      return Response.json({ error: "path outside queue" }, { status: 403 });
    const stats = statSync(realTarget);
    if (what === "reply" ? !stats.isFile() : !stats.isDirectory())
      return Response.json({ error: "result not found" }, { status: 404 });

    await launch(what, realTarget);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof MissingEntity || (error as NodeJS.ErrnoException)?.code === "ENOENT")
      return Response.json({ error: "job or result not found" }, { status: 404 });
    return Response.json({ error: "could not open result" }, { status: 500 });
  }
}
