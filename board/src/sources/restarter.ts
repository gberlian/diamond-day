import { lastRestart, restartsHome } from "../restart-log.ts";
import type { Source } from "./types.ts";
import type { Cell } from "../board.ts";
export const restarterSource: Source<Cell["restart"], [string]> = {
  read(config, ray) {
    if (!config.integrations.restarter.enabled) return null;
    const value = lastRestart(ray, config.integrations.restarter.path ?? restartsHome());
    return value ? { at: value.at, ok: value.ok, reason: value.reason } : null;
  },
};
