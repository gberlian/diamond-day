import type { BudgetSnapshot } from "../domain/codex-gate.ts";
import type { CodexUsage } from "../domain/codex-usage.ts";
import type { Source } from "./types.ts";
export const codexSource: Source<{ codex: CodexUsage | null; gate: BudgetSnapshot | null }> = {
  async read(config) {
    if (!config.integrations.codexGate.enabled) return null;
    try {
      const { context } = await import("../domain/fsreader.ts");
      const { invoke } = await import("../domain/ops.ts");
      const ctx = context(config.raysRoot);
      return { codex: invoke("codexUsage", {}, ctx) as CodexUsage,
        gate: invoke("codexBudget", {}, ctx) as BudgetSnapshot };
    } catch { return null; }
  },
};
