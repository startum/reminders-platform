import type { Config } from "@netlify/functions";
import { openDb } from "../../CleverVA/db.ts";
import { processDue } from "../../CleverVA/scheduler.ts";
import { createReminderSender } from "../../CleverVA/dispatch.ts";
import { zapierSlackSender } from "../../CleverVA/slack.ts";
import { zapierGmailSender } from "../../CleverVA/gmail.ts";

export default async () => {
  const db = openDb();
  const send = createReminderSender({ slack: zapierSlackSender, gmail: zapierGmailSender });
  const result = await processDue(db, send, new Date().toISOString());
  console.log("Reminder run:", result);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};