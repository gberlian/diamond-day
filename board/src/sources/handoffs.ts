import { existsSync } from "node:fs";
import path from "node:path";
import { context, readJobsForRay } from "../domain/fsreader.ts";
import { handoffResults } from "../handoff-results.ts";
import type { Cell } from "../board.ts";
import type { Source } from "./types.ts";

/** Handoffs are strictly opt-in: reading a nonexistent queue is not an error. */
export const handoffSource: Source<NonNullable<Cell["handoffs"]>, [string, number]> = {
  read(config, ray, now) {
    if (!config.integrations.handoffQueues.enabled) return null;
    const base = path.join(config.raysRoot, ray, ".docs", "chatgpt", "small");
    if (!existsSync(path.join(base, "queue"))) return null;
    try {
      const ctx = context(config.raysRoot, now);
      const jobs = readJobsForRay(ctx, ray);
      const names = (states: string[]) => jobs.filter((j) => states.includes(j.state)).map((j) => j.name).sort();
      const results = handoffResults(ctx, ray, jobs);
      const running = names(["running", "dead"]), queued = names(["queued"]);
      const done = results.filter((r) => r.state === "done").map((r) => r.name);
      return { running, queued, done, results, low: existsSync(path.join(base, "keeper.log")) &&
        running.length + queued.length < 2 };
    } catch { return null; }
  },
};
