import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./db.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createServer(db: Store) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(here, "public")));

  app.post("/api/reminders", (req, res) => {
    const { client_name, slack_target, message, send_at } = req.body ?? {};
    if (!client_name || !slack_target || !message || !send_at) {
      res.status(400).json({ error: "client_name, slack_target, message and send_at are all required" });
      return;
    }
    const parsed = Date.parse(send_at);
    if (Number.isNaN(parsed)) {
      res.status(400).json({ error: "send_at is not a valid date/time" });
      return;
    }
    const reminder = db.create(
      { client_name, slack_target, message, send_at: new Date(parsed).toISOString() },
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

  app.delete("/api/reminders/:id", (req, res) => {
    const ok = db.cancel(Number(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  return app;
}
