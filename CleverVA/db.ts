import { createZapierSdk } from "@zapier/zapier-sdk";

export type ReminderStatus = "pending" | "sent" | "failed";

export interface Reminder {
  id: string;
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel: "slack" | "gmail";
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  email: string | null;
  phone: string | null;
  connection_id: string | null;
  error: string | null;
}

export interface NewReminder {
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel?: "slack" | "gmail";
  email?: string | null;
  phone?: string | null;
  connection_id?: string | null;
}

export interface UpdateReminder {
  client_name?: string;
  slack_target?: string;
  message?: string;
  send_at?: string;
  channel?: "slack" | "gmail";
  email?: string | null;
  connection_id?: string | null;
}

/** Zapier Tables returns labelled fields as {value,label}; everything else as-is. */
function unwrap(v: any): any {
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}

/** Flattens a Zapier Tables record into a Reminder. */
export function toReminder(record: any): Reminder {
  const d = record?.data ?? {};
  return {
    id: record.id,
    client_name: d.client_name ?? "",
    slack_target: d.slack_target ?? "",
    message: d.message ?? "",
    send_at: d.send_at ?? "",
    channel: (unwrap(d.channel) ?? "slack") as "slack" | "gmail",
    status: (unwrap(d.status) ?? "pending") as ReminderStatus,
    created_at: d.created_at ?? "",
    sent_at: d.sent_at ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    connection_id: d.connection_id ?? null,
    error: d.error ?? null,
  };
}

export function openDb(_ignored?: string) {
  const zapier = createZapierSdk();
  const table = process.env.ZAPIER_TABLE_ID;

  if (!table) throw new Error("ZAPIER_TABLE_ID is not set");

  async function all(): Promise<Reminder[]> {
    const { data } = await zapier.listTableRecords({ table });
    return (data ?? []).map(toReminder);
  }

  async function get(id: string): Promise<Reminder | undefined> {
    try {
      const { data } = await zapier.getTableRecord({ table, record: id });
      return data ? toReminder(data) : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    async create(r: NewReminder, now: string): Promise<Reminder> {
      const { data } = await zapier.createTableRecords({
        table,
        records: [
          {
            data: {
              client_name: r.client_name,
              slack_target: r.slack_target,
              message: r.message,
              send_at: r.send_at,
              channel: r.channel ?? "slack",
              status: "pending",
              email: r.email ?? null,
              phone: r.phone ?? null,
              connection_id: r.connection_id ?? null,
              created_at: now,
            },
          },
        ],
      });
      const created = Array.isArray(data) ? data[0] : data;
      return toReminder(created);
    },

    get,

    async listPending(): Promise<Reminder[]> {
      return (await all())
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.send_at.localeCompare(b.send_at));
    },

    async listDue(now: string): Promise<Reminder[]> {
      return (await all())
        .filter((r) => r.status === "pending" && r.send_at && r.send_at <= now)
        .sort((a, b) => a.send_at.localeCompare(b.send_at));
    },

    async listSent(): Promise<Reminder[]> {
      return (await all())
        .filter((r) => r.status === "sent" || r.status === "failed")
        .sort((a, b) => String(b.sent_at ?? "").localeCompare(String(a.sent_at ?? "")));
    },

    async markSent(id: string, sentAt: string): Promise<void> {
      await zapier.updateTableRecords({
        table,
        records: [{ id, data: { status: "sent", sent_at: sentAt, error: null } }],
      });
    },

    async markFailed(id: string, error: string, sentAt: string): Promise<void> {
      await zapier.updateTableRecords({
        table,
        records: [{ id, data: { status: "failed", sent_at: sentAt, error } }],
      });
    },

    async cancel(id: string): Promise<boolean> {
      const existing = await get(id);
      if (!existing || existing.status !== "pending") return false;
      await zapier.deleteTableRecords({ table, records: [id] });
      return true;
    },

    async update(id: string, fields: UpdateReminder): Promise<Reminder | undefined> {
      const existing = await get(id);
      if (!existing || existing.status !== "pending") return undefined;

      const allowed: (keyof UpdateReminder)[] = [
        "client_name", "slack_target", "message", "send_at", "channel", "email", "connection_id",
      ];
      const payload: Record<string, any> = {};
      for (const k of allowed) {
        if (fields[k] !== undefined) payload[k] = fields[k] ?? null;
      }
      if (!Object.keys(payload).length) return existing;

      await zapier.updateTableRecords({ table, records: [{ id, data: payload }] });
      return get(id);
    },

    async close(): Promise<void> {
      // no-op: nothing to close
    },
  };
}

export type Store = ReturnType<typeof openDb>;