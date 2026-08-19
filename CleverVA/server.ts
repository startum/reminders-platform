import express from "express";
import type { Store, UpdateReminder } from "./db.ts";
import type { SlackUserCache } from "./slack-users.ts";

export function createServer(db: Store, slackUsers: SlackUserCache) {
  const app = express();
  app.use(express.json());

  app.post("/api/reminders", async (req, res) => {
    const { client_name, slack_target, message, send_at, channel: rawChannel, email, connection_id } = req.body ?? {};
    const channel = rawChannel ?? "slack";

    if (
      typeof client_name !== "string" || client_name.trim().length === 0 ||
      typeof message !== "string" || message.trim().length === 0 ||
      !send_at
    ) {
      res.status(400).json({ error: "client_name, message and send_at are all required" });
      return;
    }
    if (channel !== "slack" && channel !== "gmail") {
      res.status(400).json({ error: "channel must be 'slack' or 'gmail'" });
      return;
    }
    const parsed = Date.parse(send_at);
    if (Number.isNaN(parsed)) {
      res.status(400).json({ error: "send_at is not a valid date/time" });
      return;
    }

    let target = "";
    let emailVal: string | null = null;
    let connectionVal: string | null = null;
    if (channel === "slack") {
      if (typeof slack_target !== "string" || slack_target.trim().length === 0) {
        res.status(400).json({ error: "slack_target is required for a Slack reminder" });
        return;
      }
      if (typeof connection_id !== "string" || connection_id.trim().length === 0) {
        res.status(400).json({ error: "connection_id is required for a Slack reminder" });
        return;
      }
      target = slack_target.trim();
      connectionVal = connection_id.trim();
    } else {
      const e = typeof email === "string" ? email.trim() : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        res.status(400).json({ error: "a valid email is required for an email reminder" });
        return;
      }
      emailVal = e;
    }

    try {
      const reminder = await db.create(
        {
          client_name: client_name.trim(),
          slack_target: target,
          message: message.trim(),
          send_at: new Date(parsed).toISOString(),
          channel,
          email: emailVal,
          connection_id: connectionVal,
        },
        new Date().toISOString(),
      );
      res.status(201).json(reminder);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not save reminder: ${m}` });
    }
  });

  app.get("/api/reminders", async (req, res) => {
    try {
      if (req.query.status === "sent") {
        res.json(await db.listSent());
        return;
      }
      res.json(await db.listPending());
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not load reminders: ${m}` });
    }
  });

  app.patch("/api/reminders/:id", async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const { client_name, slack_target, message, send_at, channel, email, connection_id } = req.body ?? {};
    const fields: UpdateReminder = {};

    if (client_name !== undefined) {
      if (typeof client_name !== "string" || client_name.trim().length === 0) {
        res.status(400).json({ error: "client_name must be a non-empty string" });
        return;
      }
      fields.client_name = client_name.trim();
    }

    if (message !== undefined) {
      if (typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({ error: "message must be a non-empty string" });
        return;
      }
      fields.message = message.trim();
    }

    if (send_at !== undefined) {
      const parsed = Date.parse(send_at);
      if (Number.isNaN(parsed)) {
        res.status(400).json({ error: "send_at is not a valid date/time" });
        return;
      }
      fields.send_at = new Date(parsed).toISOString();
    }

    if (channel !== undefined) {
      if (channel !== "slack" && channel !== "gmail") {
        res.status(400).json({ error: "channel must be 'slack' or 'gmail'" });
        return;
      }
      fields.channel = channel;
    }

    try {
      const current = await db.get(id);
      const effectiveChannel = (fields.channel ?? current?.channel) as string | undefined;

      if (effectiveChannel === "slack") {
        if (slack_target !== undefined) {
          if (typeof slack_target !== "string" || slack_target.trim().length === 0) {
            res.status(400).json({ error: "slack_target must be a non-empty string" });
            return;
          }
          fields.slack_target = slack_target.trim();
        }
        if (connection_id !== undefined) {
          if (typeof connection_id !== "string" || connection_id.trim().length === 0) {
            res.status(400).json({ error: "connection_id must be a non-empty string" });
            return;
          }
          fields.connection_id = connection_id.trim();
        }
      } else if (effectiveChannel === "gmail") {
        if (email !== undefined) {
          const e = typeof email === "string" ? email.trim() : "";
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
            res.status(400).json({ error: "a valid email is required for an email reminder" });
            return;
          }
          fields.email = e;
          fields.slack_target = "";
          fields.connection_id = null;
        }
      }

      const updated = await db.update(id, fields);
      if (!updated) {
        res.status(404).json({ error: "reminder not found or already sent" });
        return;
      }
      res.json(updated);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not update reminder: ${m}` });
    }
  });

  app.get("/api/slack-users", async (req, res) => {
    try {
      const people = await slackUsers.get(req.query.refresh === "1");
      res.json(people);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not load Slack people: ${message}` });
    }
  });

  app.delete("/api/reminders/:id", async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    try {
      const ok = await db.cancel(id);
      res.status(ok ? 204 : 404).end();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Could not cancel reminder: ${m}` });
    }
  });

  return app;
}