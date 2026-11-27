export type KeeperEvent = {
  at: number;
  kind: "launched" | "done" | "failed" | "writing" | "heartbeat";
  name?: string;
  reason?: string;
  running?: number;
  queued?: number;
};

/**
 * All HH:MM:SS lines participate in rollover inference, including restarts,
 * reloaded, QUEUE EMPTY and other messages. Any strict clock regression means
 * midnight, never a new keeper session. The last line's date is the latest
 * local calendar date no later than the file mtime (or injected clock when
 * mtime lies in the future). Walk backwards through inferred day indices.
 */
export function parseKeeperLog(text: string, anchorMs: number): KeeperEvent[] {
  const parsed: { day: number; seconds: number; message: string }[] = [];
  let previous: number | null = null;
  let day = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d\d):(\d\d):(\d\d)\s+(.+)$/.exec(line);
    if (!match) continue;
    const h = Number(match[1]), m = Number(match[2]), s = Number(match[3]);
    if (h > 23 || m > 59 || s > 59) continue;
    const seconds = h * 3600 + m * 60 + s;
    if (previous !== null && seconds < previous) day++;
    parsed.push({ day, seconds, message: match[4]! });
    previous = seconds;
  }
  if (!parsed.length) return [];
  const base = new Date(anchorMs);
  const last = parsed[parsed.length - 1]!;
  const anchorSeconds = base.getHours() * 3600 + base.getMinutes() * 60 + base.getSeconds();
  base.setHours(0, 0, 0, 0);
  if (last.seconds > anchorSeconds) base.setDate(base.getDate() - 1);
  const dayStarts = new Map<number, number>();
  const events: KeeperEvent[] = [];
  for (const row of parsed) {
    let start = dayStarts.get(row.day);
    if (start === undefined) {
      const local = new Date(base);
      local.setDate(local.getDate() + row.day - last.day);
      start = local.getTime();
      dayStarts.set(row.day, start);
    }
    const localTime = new Date(start);
    localTime.setHours(Math.floor(row.seconds / 3600), Math.floor(row.seconds % 3600 / 60),
      row.seconds % 60, 0);
    const at = localTime.getTime();
    const message = row.message;
    const launch = /^launched ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const done = /^done ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const failed = /^failed ([a-zA-Z0-9][\w.-]*)(?::\s*(.*)|\s+(\(.*\)))?\s*$/.exec(message);
    const writing = /^still writing ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const beat = /^HEARTBEAT running=(\d+) queued=(\d+)(?:\s|$)/.exec(message);
    if (launch) events.push({ at, kind: "launched", name: launch[1] });
    else if (done) events.push({ at, kind: "done", name: done[1] });
    else if (failed) events.push({ at, kind: "failed", name: failed[1], reason: failed[2] ?? failed[3] });
    else if (writing) events.push({ at, kind: "writing", name: writing[1] });
    else if (beat) events.push({ at, kind: "heartbeat", running: Number(beat[1]), queued: Number(beat[2]) });
  }
  return events;
}

