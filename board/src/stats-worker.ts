import { parentPort, workerData } from "node:worker_threads";
import { collectStats, type StatsOptions } from "./stats.ts";
import { renderStatsPage } from "./stats-page.ts";
const stats = await collectStats(workerData as StatsOptions);
parentPort!.postMessage({ json: JSON.stringify(stats), html: renderStatsPage(stats) });
parentPort!.close();
