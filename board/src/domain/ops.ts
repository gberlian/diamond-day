import { z } from "zod";
import {
  ensureRay, rayNames, readJob, readJobsForRay, readKeeper, readRay,
  type DomainContext, context,
} from "./fsreader.ts";
import {
  CapacitySchema, FailedRaySchema, JobDetailSchema, JobSchema, JobTimelineSchema,
  JobStateSchema, KeeperSchema, RaySchema, ThroughputSchema, TooEasyJobSchema,
} from "./model.ts";

import { timelinesForRay, throughput as deriveThroughput, tooEasy as deriveTooEasy } from "./handoffs.ts";
import { codexUsageAt } from "./codex-usage.ts";
import { codexGate } from "./codex-gate.ts";

const RayName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use a single ray folder name");
const JobName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use a single job name");
const empty = z.strictObject({});
const withRay = z.strictObject({ ray: RayName });
const getJobInput = z.strictObject({ ray: RayName, name: JobName });
const jobsFilter = z.strictObject({
  ray: RayName.optional(),
  state: JobStateSchema.optional(),
  sinceHours: z.number().finite().positive().optional(),
});
const healthFilter = z.strictObject({ ray: RayName.optional() });
const timelineFilter = z.strictObject({ ray: RayName.optional(), name: JobName.optional() });
const historyWindow = (defaultHours: number) => z.strictObject({
  hours: z.number().finite().positive().max(720).default(defaultHours),
});

const CallerUsageSchema = z.strictObject({
  name: z.string(), kind: z.enum(["namer", "feeder", "cli", "proxy"]),
  oneHour: z.number().int().nonnegative(),
  fiveHours: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  callsPerHour: z.number().nonnegative(),
  firstAt: z.number().nullable(), lastAt: z.number().nullable(),
});
const CallCountsSchema = z.strictObject({
  oneHour: z.number().int().nonnegative(),
  fiveHours: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  callsPerHour: z.number().nonnegative(),
});
const CodexUsageSchema = z.strictObject({
  at: z.number(), callers: z.array(CallerUsageSchema), totals: CallCountsSchema,
  lastLimitAt: z.number().nullable(),
  estimatedFiveHourCalls: z.number().int().nonnegative().nullable(),
  projectedLimitAt: z.number().nullable(),
  warning: z.boolean(), warningAt: z.number().nullable(),
});

const CodexKindSchema = z.enum(["interactive", "relay", "batch"]);
const CodexAdmissionSchema = z.discriminatedUnion("admitted", [
  z.strictObject({ admitted: z.literal(true), leaseId: z.string(), expiresAt: z.number(), failOpen: z.literal(false) }),
  z.strictObject({ admitted: z.literal(false), state: z.enum(["waiting", "paused"]),
    reason: z.string(), waitSeconds: z.number().int().nonnegative(), retryAt: z.number(),
    pauseUntil: z.string().nullable() }),
]);
const CodexBudgetSchema = z.strictObject({
  at: z.number(), capacity: z.number().int().nonnegative(), used: z.number().int().nonnegative(),
  reservedInteractive: z.number().int().nonnegative(), reservedRelay: z.number().int().nonnegative(),
  projectedLimitAt: z.number().nullable(), lastLimitAt: z.number().nullable(), warning: z.boolean(),
  callers: z.array(z.strictObject({
    name: z.string(), kind: CodexKindSchema, priority: z.number().int(),
    callsPerHour: z.number().int().positive(), cap: z.number().int().positive(),
    tokens: z.number().nonnegative(), usedHour: z.number().int().nonnegative(),
    usedFiveHours: z.number().int().nonnegative(), leases: z.number().int().nonnegative(),
    state: z.enum(["running", "waiting", "paused"]), waitSeconds: z.number().int().nonnegative(),
  })),
});

/** An operation has exactly one Zod input, Zod output, description and handler. */
export function operation<I extends z.ZodType, O extends z.ZodType>(
  description: string, input: I, output: O,
  handler: (ctx: DomainContext, args: z.output<I>) => z.output<O>,
) { return { description, input, output, handler }; }

export const operations = {
  listRays: operation("List configured rays, their queue counts and keeper heartbeat",
    empty, z.array(RaySchema), (ctx) => rayNames(ctx.root).map((ray) => readRay(ctx, ray))),
  getRay: operation("Get one ray, its queue counts and keeper heartbeat",
    withRay, RaySchema, (ctx, { ray }) => { ensureRay(ctx, ray); return readRay(ctx, ray); }),
  listJobs: operation("List handoffs, optionally filtered by ray, state or recent prompt mtime",
    jobsFilter, z.array(JobSchema), (ctx, { ray, state, sinceHours }) => {
      if (ray) ensureRay(ctx, ray);
      return (ray ? [ray] : rayNames(ctx.root))
        .flatMap((r) => readJobsForRay(ctx, r))
        .filter((job) => (!state || job.state === state) &&
          (sinceHours === undefined || (job.ageMs !== null && job.ageMs <= sinceHours * 3_600_000)))
        .sort((a, b) => a.ray.localeCompare(b.ray) || a.name.localeCompare(b.name));
    }),
  getJob: operation("Get a handoff with the first 4096 reply characters and last 20 log lines",
    getJobInput, JobDetailSchema, (ctx, { ray, name }) => {
      ensureRay(ctx, ray); return readJob(ctx, ray, name);
    }),
  keeperHealth: operation("Inspect keeper heartbeat freshness (>10 minutes is stale)",
    healthFilter, z.strictObject({
      keepers: z.array(KeeperSchema), stale: z.array(z.string()),
    }), (ctx, { ray }) => {
      if (ray) ensureRay(ctx, ray);
      const keepers = (ray ? [ray] : rayNames(ctx.root)).map((r) => readKeeper(ctx, r));
      return { keepers, stale: keepers.filter((k) => k.stale).map((k) => k.ray) };
    }),
  deadJobs: operation("Running handoffs with chat UUID, no reply line and an error/Bun banner last line",
    empty, z.array(JobSchema), (ctx) => rayNames(ctx.root)
      .flatMap((ray) => readJobsForRay(ctx, ray).filter((job) => job.state === "dead"))),
  failedSummary: operation("Failed handoffs grouped by ray, with keeper failure reasons and reply paths",
    empty, z.array(FailedRaySchema), (ctx) => rayNames(ctx.root).flatMap((ray) => {
      const jobs = readJobsForRay(ctx, ray).filter((j) => j.state === "failed")
        .map((j) => ({ name: j.name, reason: j.failureReason, replyPath: j.replyPath }));
      return jobs.length ? [{ ray, jobs }] : [];
    })),
  jobTimeline: operation("Reconstruct handoff attempts and queue metadata from keeper history",
    timelineFilter, z.array(JobTimelineSchema), (ctx, { ray, name }) => {
      if (ray) ensureRay(ctx, ray);
      return (ray ? [ray] : rayNames(ctx.root))
        .flatMap((r) => timelinesForRay(ctx, r, name))
        .sort((a, b) => a.ray.localeCompare(b.ray) || a.name.localeCompare(b.name));
    }),
  throughput: operation("Keeper launches, terminal outcomes and 10-minute occupancy by ray",
    historyWindow(24), ThroughputSchema, (ctx, { hours }) => deriveThroughput(ctx, hours)),
  tooEasy: operation("Completed handoffs with measurable think time below 10 minutes",
    historyWindow(48), z.array(TooEasyJobSchema), (ctx, { hours }) => deriveTooEasy(ctx, hours)),
  codexUsage: operation("Count calls per ChatGPT-login Codex caller (1h/5h/24h), rate and provisional limit warning",
    empty, CodexUsageSchema, (ctx) => codexUsageAt(ctx.now)),
  codexAdmit: operation("Atomically lease shared Codex quota before calling it",
    z.strictObject({ caller: RayName, kind: CodexKindSchema,
      cost: z.number().int().positive().max(100000).default(1) }),
    CodexAdmissionSchema, (ctx, { caller, kind, cost }) => codexGate().admit(caller, kind, cost, ctx.now)),
  codexRelease: operation("Record Codex lease outcome or usage limit",
    z.strictObject({ leaseId: z.string().min(1), outcome: z.enum(["ok", "limit", "error"]) }),
    z.strictObject({ released: z.boolean() }),
    (ctx, { leaseId, outcome }) => codexGate().release(leaseId, outcome, ctx.now)),
  codexBudget: operation("Read per-caller Codex caps, leases and admission state",
    empty, CodexBudgetSchema, (ctx) => codexGate().budget(ctx.now)),
  capacity: operation("Count physical running queue entries against keeper's machine-wide 20-tab cap",
    empty, CapacitySchema, (ctx) => {
      const byRay = rayNames(ctx.root).map((ray) => {
        const jobs = readJobsForRay(ctx, ray);
        return { ray,
          queued: jobs.filter((j) => j.state === "queued").length,
          running: jobs.filter((j) => j.state === "running" || j.state === "dead").length,
        };
      });
      const running = byRay.reduce((sum, r) => sum + r.running, 0);
      return { running, cap: 20 as const, available: Math.max(0, 20 - running),
        overCap: running > 20, byRay };
    }),
} as const;

export type OperationName = keyof typeof operations;
export const operationNames = Object.keys(operations) as OperationName[];
export const isOperation = (name: string): name is OperationName =>
  Object.prototype.hasOwnProperty.call(operations, name);

/** Only source of dispatch/validation shared by HTTP, MCP, CLI and the board. */
export function invoke(name: OperationName, rawInput: unknown, ctx: DomainContext = context()): unknown {
  // The union of different handler signatures is intentionally resolved in this one place,
  // never separately on the individual transports.
  const op = operations[name] as ReturnType<typeof operation<z.ZodType, z.ZodType>>;
  const input = op.input.parse(rawInput);
  return op.output.parse(op.handler(ctx, input));
}

export const handlers = (ctx: DomainContext = context()) =>
  Object.fromEntries(operationNames.map((name) => [name, (input: unknown) => invoke(name, input, ctx)])) as
  Record<OperationName, (input: unknown) => unknown>;
