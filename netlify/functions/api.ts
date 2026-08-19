import serverless from "serverless-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../CleverVA/db.ts";
import { createServer } from "../../CleverVA/server.ts";
import { createSlackUserCache, fetchSlackUsers } from "../../CleverVA/slack-users.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const db = openDb(path.join(here, "reminders.db"));
const slackUsers = createSlackUserCache(fetchSlackUsers);
const app = createServer(db, slackUsers);

export const handler = serverless(app);