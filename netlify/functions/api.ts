import serverless from "serverless-http";
import path from "node:path";
import { openDb } from "../../CleverVA/db.ts";
import { createServer } from "../../CleverVA/server.ts";
import { createSlackUserCache, fetchSlackUsers } from "../../CleverVA/slack-users.ts";

const db = openDb(path.join("/tmp", "reminders.db"));
const slackUsers = createSlackUserCache(fetchSlackUsers);
const app = createServer(db, slackUsers);

export const handler = serverless(app);