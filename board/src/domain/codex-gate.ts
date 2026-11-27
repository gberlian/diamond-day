/** Single-process, synchronous/atomic Codex admission controller.
 * All transports dispatch into this one instance. Leases are charged at admit,
 * not when the eventually consistent service log becomes readable.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codexLimitSamplesAt, codexUsageAt, type CodexUsage } from "./codex-usage.ts";

const HOUR = 3_600_000, FIVE = 5 * HOUR;
export type CodexKind = "interactive" | "relay" | "batch";
export type ReleaseResult = "ok" | "limit" | "error";
export type CallerPolicy = { kind: CodexKind; priority: number; callsPerHour: number };
export type BudgetPolicy = {
  fallbackFiveHourCalls: number; calibrationHits: number;
  warningMinutes: number; pauseMinutes: number; slowWaitSeconds: number;
  leaseSeconds: number; reservedInteractive: number; reservedRelay: number;
  callers: Record<string, CallerPolicy>;
};
export type Admission =
  | { admitted: true; leaseId: string; expiresAt: number; failOpen: false }
  | { admitted: false; state: "waiting" | "paused"; reason: string; waitSeconds: number; retryAt: number; pauseUntil: string | null };
export type CallerBudget = {
  name: string; kind: CodexKind; priority: number; callsPerHour: number;
  cap: number; tokens: number; usedHour: number; usedFiveHours: number;
  leases: number; state: "running" | "waiting" | "paused";
  waitSeconds: number;
};
export type BudgetSnapshot = {
  at: number; capacity: number; used: number; reservedInteractive: number; reservedRelay: number;
  projectedLimitAt: number | null; lastLimitAt: number | null; warning: boolean;
  callers: CallerBudget[];
};
export class CodexGateInputError extends Error {}
export const DEFAULT_BUDGET = fileURLToPath(new URL("../../codex-budget.json", import.meta.url));

type Charge = { name: string; at: number; cost: number; pendingCost: number };
type Lease = { name: string; at: number; expiresAt: number; cost: number };
type Bucket = { tokens: number; updatedAt: number };
const finite = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const policyValid = (p: any): p is BudgetPolicy =>
  p && finite(p.fallbackFiveHourCalls, 1, 1e7) && Number.isInteger(p.fallbackFiveHourCalls) &&
  finite(p.calibrationHits, 1, 100) && Number.isInteger(p.calibrationHits) &&
  finite(p.warningMinutes, 0, 300) && finite(p.pauseMinutes, 0, p.warningMinutes) &&
  finite(p.slowWaitSeconds, 1, 3600) && finite(p.leaseSeconds, 1, 3600) &&
  finite(p.reservedInteractive, 0, 0.9) && finite(p.reservedRelay, 0, 0.9) &&
  p.reservedInteractive + p.reservedRelay < 1 &&
  p.callers && typeof p.callers === "object" && !Array.isArray(p.callers) &&
  Object.keys(p.callers).length > 0 && Object.entries(p.callers).every(([name, entry]) => {
    const c = entry as any;
    return /^[a-zA-Z0-9][\w.-]*$/.test(name) &&
      ["interactive", "relay", "batch"].includes(c?.kind) &&
      finite(c.priority, 0, 100) && Number.isInteger(c.priority) &&
      finite(c.callsPerHour, 1, 100000) && Number.isInteger(c.callsPerHour);
  });
const median = (items: number[]) => {
  const values = [...items].sort((a, b) => a - b);
  const m = Math.floor(values.length / 2);
  return values.length % 2 ? values[m]! : Math.floor((values[m - 1]! + values[m]!) / 2);
};

export class CodexGate {
  private policy!: BudgetPolicy;
  private fingerprint = "";
  private buckets = new Map<string, Bucket>();
  private leases = new Map<string, Lease>();
  private charges: Charge[] = [];
  private lastSeen = new Map<string, number>();
  private lastLimit: number | null = null;
  private sequence = 0;
  private lastDecision = new Map<string, "running" | "waiting" | "paused">();
  private options: {
    policyPath?: string;
    usage?: (at: number) => CodexUsage;
    samples?: (at: number) => { at: number; calls: number }[];
  };
  constructor(options: {
    policyPath?: string;
    usage?: (at: number) => CodexUsage;
    samples?: (at: number) => { at: number; calls: number }[];
  } = {}) { this.options = options; this.reload(); }

  /** Reload on mtime and size change without restarting ray-board. Invalid edits fail closed. */
  private reload(): void {
    const file = this.options.policyPath ?? process.env.CODEX_BUDGET_CONFIG ?? DEFAULT_BUDGET;
    if (!existsSync(file)) throw new Error(`Codex budget configuration missing: ${file}`);
    const stat = statSync(file);
    const fingerprint = `${file}|${stat.mtimeMs}|${stat.size}`;
    if (this.fingerprint === fingerprint) return;
    const fresh: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!policyValid(fresh)) throw new Error("Invalid codex-budget.json");
    this.policy = fresh;
    this.fingerprint = fingerprint;
    for (const [name, bucket] of this.buckets)
      bucket.tokens = Math.min(bucket.tokens, this.policy.callers[name]?.callsPerHour ?? 0);
  }
  private cleanup(now: number): void {
    for (const [id, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(id);
    this.charges = this.charges.filter((c) => c.at > now - FIVE && c.at <= now);
  }
  private metrics(now: number) {
    this.reload();
    this.cleanup(now);
    const usage = (this.options.usage ?? codexUsageAt)(now);
    const capacitySamples = (this.options.samples ?? codexLimitSamplesAt)(now)
      .filter((x) => x.at <= now && x.calls > 0).sort((a, b) => b.at - a.at)
      .slice(0, this.policy.calibrationHits).map((x) => x.calls);
    const capacity = capacitySamples.length ? median(capacitySamples) : this.policy.fallbackFiveHourCalls;
    if (usage.lastLimitAt !== null && usage.lastLimitAt <= now &&
        (this.lastLimit === null || usage.lastLimitAt > this.lastLimit)) this.lastLimit = usage.lastLimitAt;
    const observed = new Map(usage.callers.map((c) => [c.name, c]));
    // A log increase acknowledges the oldest as-yet-unseen gate charges, avoiding double counts.
    for (const [name, row] of observed) {
      const old = this.lastSeen.get(name);
      if (old !== undefined && row.fiveHours > old) {
        let delta = row.fiveHours - old;
        for (const entry of this.charges) if (entry.name === name && entry.pendingCost > 0 && delta > 0) {
          const matched = Math.min(entry.pendingCost, delta);
          entry.pendingCost -= matched; delta -= matched;
        }
      }
      this.lastSeen.set(name, row.fiveHours);
    }
    const unmatched = this.charges.filter((c) => c.pendingCost > 0);
    const debts = (name: string, duration: number) => unmatched
      .filter((c) => c.name === name && c.at > now - duration).reduce((s, c) => s + c.pendingCost, 0);
    const used = usage.totals.fiveHours + unmatched.reduce((s, c) => s + c.pendingCost, 0);
    const rate = usage.totals.oneHour + unmatched
      .filter((c) => c.at > now - HOUR).reduce((s, c) => s + c.pendingCost, 0);
    const predicted = rate > 0 ? now + Math.max(0, capacity - used) / rate * HOUR : null;
    const estimates = [predicted, usage.projectedLimitAt].filter((v): v is number => v !== null && v >= 0);
    const projectedLimitAt = estimates.length ? Math.min(...estimates) : null;
    const warning = projectedLimitAt !== null && projectedLimitAt < now + this.policy.warningMinutes * 60_000;
    const oldest = [
      ...this.charges.map((c) => c.at),
      ...usage.callers.map((c) => c.firstAt).filter((v): v is number => v !== null && v > now - FIVE),
    ].filter((t) => t > now - FIVE);
    const resetAt = oldest.length ? Math.min(...oldest) + FIVE : now + FIVE;
    return { usage, observed, debts, capacity, used, projectedLimitAt, warning, resetAt };
  }
  private bucket(name: string, now: number): Bucket {
    const cap = this.policy.callers[name]!.callsPerHour;
    let b = this.buckets.get(name);
    if (!b) { b = { tokens: cap, updatedAt: now }; this.buckets.set(name, b); }
    b.tokens = Math.min(cap, b.tokens + Math.max(0, now - b.updatedAt) * cap / HOUR);
    b.updatedAt = now;
    return b;
  }
  private decision(name: string, kind: CodexKind, cost: number, now: number, m: ReturnType<CodexGate["metrics"]>) {
    const p = this.policy.callers[name];
    if (!p || p.kind !== kind) throw new CodexGateInputError(`Unknown caller or kind: ${name}/${kind}`);
    if (cost > p.callsPerHour) return { waitMs: HOUR, reason: "cap" };
    const activeLimit = this.lastLimit !== null && this.lastLimit <= now && now < this.lastLimit + FIVE;
    if (activeLimit && kind !== "interactive") return { waitMs: this.lastLimit! + FIVE - now, reason: "limit" };
    const reservedInteractive = Math.ceil(m.capacity * this.policy.reservedInteractive);
    const reservedRelay = Math.ceil(m.capacity * this.policy.reservedRelay);
    const ceiling = kind === "batch" ? m.capacity - reservedInteractive - reservedRelay :
      kind === "relay" ? m.capacity - reservedInteractive : m.capacity;
    if (!activeLimit && m.used + cost > ceiling) return { waitMs: Math.max(1000, m.resetAt - now), reason: "budget" };
    const b = this.bucket(name, now);
    if (b.tokens + 1e-9 < cost) return {
      waitMs: Math.ceil((cost - b.tokens) * HOUR / p.callsPerHour), reason: "cap",
    };
    if (kind === "batch" && m.warning) {
      const remaining = (m.projectedLimitAt! - now) / 60_000;
      if (remaining <= this.policy.pauseMinutes) return {
        waitMs: Math.max(1000, m.resetAt - now), reason: "projection",
      };
      // Gate one batch pass per warning interval (not just a per-request retry loop).
      if (this.lastDecision.get(name) === "waiting") {
        // A warning wait must not permanently block a caller once the clock advances.
        const until = this.warningUntil.get(name) ?? 0;
        if (now < until) return { waitMs: until - now, reason: "projection" };
      }
    }
    return { waitMs: 0, reason: "ok" };
  }
  private warningUntil = new Map<string, number>();

  admit(name: string, kind: CodexKind, cost = 1, now = Date.now()): Admission {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100000) throw new Error("Invalid cost");
    const m = this.metrics(now);
    const d = this.decision(name, kind, cost, now, m);
    if (d.waitMs) {
      const wait = Math.ceil(d.waitMs / 1000);
      const state = d.reason === "limit" || d.reason === "budget" ||
        (d.reason === "projection" && wait >= this.policy.pauseMinutes * 60)
        ? "paused" : "waiting";
      this.lastDecision.set(name, state);
      return { admitted: false, state, reason: d.reason, waitSeconds: wait,
        retryAt: now + wait * 1000,
        pauseUntil: state === "paused" ? new Date(now + wait * 1000).toISOString().slice(11, 16) : null };
    }
    const b = this.bucket(name, now);
    b.tokens -= cost;
    // The warning threshold slows a successful batch too: subsequent admits must wait.
    if (kind === "batch" && m.warning) {
      this.warningUntil.set(name, now + this.policy.slowWaitSeconds * 1000);
      this.lastDecision.set(name, "waiting");
    } else this.lastDecision.set(name, "running");
    const leaseId = `${now.toString(36)}-${++this.sequence}-${crypto.randomUUID()}`;
    const expiresAt = now + this.policy.leaseSeconds * 1000;
    this.leases.set(leaseId, { name, at: now, expiresAt, cost });
    this.charges.push({ name, at: now, cost, pendingCost: cost });
    return { admitted: true, leaseId, expiresAt, failOpen: false };
  }
  release(leaseId: string, outcome: ReleaseResult, now = Date.now()): { released: boolean } {
    if (!["ok", "limit", "error"].includes(outcome)) throw new Error("Invalid release status");
    this.cleanup(now);
    const lease = this.leases.get(leaseId);
    if (!lease) return { released: false };
    this.leases.delete(leaseId);
    if (outcome === "limit") this.lastLimit = Math.max(this.lastLimit ?? 0, now);
    // An 'error' may still consume quota. Keep its charge, as with expired leases.
    return { released: true };
  }
  budget(now = Date.now()): BudgetSnapshot {
    const m = this.metrics(now);
    const callers = Object.entries(this.policy.callers).sort((a, b) => b[1].priority - a[1].priority)
      .map(([name, p]): CallerBudget => {
        const d = this.decision(name, p.kind, 1, now, m);
        const state = d.waitMs ?
          (d.reason === "limit" || d.reason === "budget" || d.reason === "projection" &&
            d.waitMs >= this.policy.pauseMinutes * 60_000 ? "paused" : "waiting") : "running";
        const row = m.observed.get(name);
        const leases = [...this.leases.values()].filter((l) => l.name === name).length;
        return { name, kind: p.kind, priority: p.priority, cap: p.callsPerHour,
          callsPerHour: p.callsPerHour, tokens: Math.max(0, Math.floor(this.bucket(name, now).tokens * 100) / 100),
          usedHour: (row?.oneHour ?? 0) + m.debts(name, HOUR),
          usedFiveHours: (row?.fiveHours ?? 0) + m.debts(name, FIVE),
          leases, state, waitSeconds: Math.ceil(d.waitMs / 1000) };
      });
    return { at: now, capacity: m.capacity, used: m.used,
      reservedInteractive: Math.ceil(m.capacity * this.policy.reservedInteractive),
      reservedRelay: Math.ceil(m.capacity * this.policy.reservedRelay),
      projectedLimitAt: m.projectedLimitAt, lastLimitAt: this.lastLimit, warning: m.warning, callers };
  }
}
let singleton: CodexGate | undefined;
export const codexGate = () => singleton ??= new CodexGate();
