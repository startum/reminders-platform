import { openDb } from "./db.ts";
import { createServer } from "./server.ts";
import { startScheduler } from "./scheduler.ts";
import { zapierSlackSender } from "./slack.ts";
import { zapierGmailSender } from "./gmail.ts";
import { createReminderSender } from "./dispatch.ts";
import { createSlackUserCache, fetchSlackUsers } from "./slack-users.ts";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);

const db = openDb();
const slackUsers = createSlackUserCache(fetchSlackUsers);
const send = createReminderSender({ slack: zapierSlackSender, gmail: zapierGmailSender });
const app = createServer(db, slackUsers);

// Serve the frontend locally (Netlify serves these itself in production)
app.use(express.static(path.join(here, "public")));

startScheduler(db, send);

app.listen(PORT, () => {
  console.log(`Clever VA Reminders running at http://localhost:${PORT}`);
});