import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./db.ts";
import type { SlackUserCache } from "./slack-users.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createServer(db: Store, slackUsers: SlackUserCache) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(here, "public")));

  app.post("/api/reminders", (req, res) => {
    const { client_name, slack_target, message, send_at } = req.body ?? {};
    if (
      typeof client_name !== "string" || client_name.trim().length === 0 ||
      typeof slack_target !== "string" || slack_target.trim().length === 0 ||
      typeof message !== "string" || message.trim().length === 0 ||
      !send_at
    ) {
      res.status(400).json({ error: "client_name, slack_target, message and send_at are all required" });
      return;
    }
    const parsed = Date.parse(send_at);
    if (Number.isNaN(parsed)) {
      res.status(400).json({ error: "send_at is not a valid date/time" });
      return;
    }
    const reminder = db.create(
      {
        client_name: client_name.trim(),
        slack_target: slack_target.trim(),
        message: message.trim(),
        send_at: new Date(parsed).toISOString(),
      },
      new Date().toISOString(),
    );
    res.status(201).json(reminder);
  });

  app.get("/api/reminders", (req, res) => {
    if (req.query.status === "sent") {
      res.json(db.listSent());
      return;
    }
    res.json(db.listPending());
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

  app.delete("/api/reminders/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const ok = db.cancel(id);
    res.status(ok ? 204 : 404).end();
  });

  return app;
}
