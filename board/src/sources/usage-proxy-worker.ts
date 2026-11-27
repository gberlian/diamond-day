import { parentPort, workerData } from "node:worker_threads";
import { proxySource } from "./usage-proxy.ts";
import type { BoardConfig } from "../config.ts";
parentPort!.postMessage(await proxySource.read(workerData as BoardConfig));
parentPort!.close();
