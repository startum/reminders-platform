import Database from "better-sqlite3";

export type ReminderStatus = "pending" | "sent" | "failed";

export interface Reminder {
  id: number;
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel: "slack" | "gmail";
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  email: string | null;
  error: string | null;
}

export interface NewReminder {
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel?: "slack" | "gmail";
  email?: string | null;
}

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      slack_target TEXT NOT NULL,
      message TEXT NOT NULL,
      send_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'slack' CHECK(channel IN ('slack','gmail')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      email TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      error TEXT
    );
  `);

  const cols = (db.prepare("PRAGMA table_info(reminders)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("channel")) {
    db.exec("ALTER TABLE reminders ADD COLUMN channel TEXT NOT NULL DEFAULT 'slack'");
  }
  if (!cols.includes("email")) {
    db.exec("ALTER TABLE reminders ADD COLUMN email TEXT");
  }

  function get(id: number): Reminder | undefined {
    return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as Reminder | undefined;
  }

  return {
    create(r: NewReminder, now: string): Reminder {
      const info = db
        .prepare(
          `INSERT INTO reminders (client_name, slack_target, message, send_at, channel, email, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(r.client_name, r.slack_target, r.message, r.send_at, r.channel ?? "slack", r.email ?? null, now);
      return get(Number(info.lastInsertRowid))!;
    },

    get,

    listPending(): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status = 'pending' ORDER BY send_at ASC`)
        .all() as Reminder[];
    },

    listDue(now: string): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC`)
        .all(now) as Reminder[];
    },

    listSent(): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status IN ('sent', 'failed') ORDER BY sent_at DESC`)
        .all() as Reminder[];
    },

    markSent(id: number, sentAt: string): void {
      db.prepare(`UPDATE reminders SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`).run(sentAt, id);
    },

    markFailed(id: number, error: string, sentAt: string): void {
      db.prepare(`UPDATE reminders SET status = 'failed', sent_at = ?, error = ? WHERE id = ?`).run(sentAt, error, id);
    },

    cancel(id: number): boolean {
      const info = db.prepare(`DELETE FROM reminders WHERE id = ? AND status = 'pending'`).run(id);
      return info.changes > 0;
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openDb>;
