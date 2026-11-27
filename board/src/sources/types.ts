import type { BoardConfig } from "../config.ts";
/** A disabled or unavailable integration returns null, never a placeholder. */
export interface Source<T, A extends unknown[] = []> {
  read(config: BoardConfig, ...args: A): T | null | Promise<T | null>;
}
