import { z } from "zod";

export const JobStateSchema = z.enum(["queued", "running", "done", "failed", "cancelled", "dead"]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobSchema = z.strictObject({
  name: z.string(),
  ray: z.string(),
  state: JobStateSchema,
  promptPath: z.string(),
  chatId: z.string().nullable(),
  tries: z.number().int().nonnegative(),
  priority: z.number().finite().nullable(),
  attachments: z.array(z.string()),
  replyPath: z.string().nullable(),
  zipDir: z.string().nullable(),
  ageMs: z.number().nonnegative().nullable(),
  idleMs: z.number().nonnegative().nullable(),
  lastLogLine: z.string().nullable(),
  failureReason: z.string().nullable(),
  logPath: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobDetailSchema = JobSchema.extend({
  replyHead: z.string().nullable(),
  logTail: z.array(z.string()),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const KeeperSchema = z.strictObject({
  ray: z.string(),
  pid: z.number().int().positive().nullable(),
  version: z.string().nullable(),
  heartbeatAt: z.string().nullable(),
  heartbeatAgeMs: z.number().nonnegative().nullable(),
  phase: z.string().nullable(),
  heartbeatRunning: z.number().int().nonnegative().nullable(),
  running: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  fresh: z.boolean(),
  stale: z.boolean(),
});
export type Keeper = z.infer<typeof KeeperSchema>;

export const CountsSchema = z.strictObject({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  dead: z.number().int().nonnegative(),
});

export const RaySchema = z.strictObject({
  name: z.string(),
  path: z.string(),
  queueDir: z.string(),
  counts: CountsSchema,
  keeper: KeeperSchema,
});
export type Ray = z.infer<typeof RaySchema>;

// The session fields are sourced from the existing board's Claude transcript/usage cell.
export const SessionSchema = z.strictObject({
  busy: z.boolean(),
  line: z.string(),
  ago: z.number().nullable(),
  since: z.string(),
  ctx: z.number().nullable(),
  fivePct: z.number().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const FailedJobSchema = z.strictObject({
  name: z.string(),
  reason: z.string().nullable(),
  replyPath: z.string().nullable(),
});

export const FailedRaySchema = z.strictObject({
  ray: z.string(),
  jobs: z.array(FailedJobSchema),
});

export const CapacityRaySchema = z.strictObject({
  ray: z.string(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
});

export const CapacitySchema = z.strictObject({
  running: z.number().int().nonnegative(),
  cap: z.literal(20),
  available: z.number().int().nonnegative(),
  overCap: z.boolean(),
  byRay: z.array(CapacityRaySchema),
});

/** Keeper history timestamps are ISO UTC; nullable fields represent unavailable evidence. */
export const JobTimelineSchema = z.strictObject({
  ray: z.string(),
  name: z.string(),
  queuedAt: z.string().nullable(),
  launchedAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  thinkMinutes: z.number().nonnegative().nullable(),
  tries: z.number().int().nonnegative(),
  replyBytes: z.number().int().nonnegative().nullable(),
  zipPresent: z.boolean(),
  promptBytes: z.number().int().nonnegative().nullable(),
  outcome: z.enum(["queued", "running", "done", "failed", "cancelled", "dead", "unknown"]),
});
export type JobTimeline = z.infer<typeof JobTimelineSchema>;

export const OccupancyPointSchema = z.strictObject({
  at: z.string(),
  running: z.number().int().nonnegative().nullable(),
});
export type OccupancyPoint = z.infer<typeof OccupancyPointSchema>;

export const ThroughputCountsSchema = z.strictObject({
  launched: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  medianThinkMinutes: z.number().nonnegative().nullable(),
  p90ThinkMinutes: z.number().nonnegative().nullable(),
  jobsPerHour: z.number().nonnegative(),
  occupancy: z.array(OccupancyPointSchema),
});
export const ThroughputRaySchema = ThroughputCountsSchema.extend({ ray: z.string() });
export const ThroughputSchema = z.strictObject({
  hours: z.number().positive(),
  machine: ThroughputCountsSchema,
  byRay: z.array(ThroughputRaySchema),
});
export type ThroughputRow = z.infer<typeof ThroughputRaySchema>;
export type Throughput = z.infer<typeof ThroughputSchema>;

export const TooEasyJobSchema = z.strictObject({
  ray: z.string(),
  name: z.string(),
  launchedAt: z.string(),
  doneAt: z.string(),
  thinkMinutes: z.number().nonnegative(),
  promptBytes: z.number().int().nonnegative().nullable(),
});
export type TooEasyJob = z.infer<typeof TooEasyJobSchema>;
