import type { Store } from "./db.ts";
import type { ReminderSend } from "./dispatch.ts";

export interface ProcessResult {
  sent: number;
  failed: number;
}

/** Sends every pending reminder due at or before `now`. Each is processed independently. */
export async function processDue(db: Store, send: ReminderSend, now: string): Promise<ProcessResult> {
  const due = db.listDue(now);
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    try {
      await send(r);
      db.markSent(r.id, now);
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markFailed(r.id, message, now);
      failed++;
    }
  }
  return { sent, failed };
}

/** Starts a repeating loop that processes due reminders. Returns the interval handle. */
export function startScheduler(db: Store, send: ReminderSend, intervalMs = 30_000): NodeJS.Timeout {
  const tick = () => {
    processDue(db, send, new Date().toISOString()).catch((err) => console.error("scheduler tick failed:", err));
  };
  tick();
  return setInterval(tick, intervalMs);
}
