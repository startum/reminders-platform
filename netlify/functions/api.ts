import serverless from "serverless-http";
import { openDb } from "../../CleverVA/db.ts";
import { createServer } from "../../CleverVA/server.ts";
import { createSlackUserCache, fetchSlackUsers } from "../../CleverVA/slack-users.ts";

const db = openDb();
const slackUsers = createSlackUserCache(fetchSlackUsers);
const app = createServer(db, slackUsers);

export const handler = serverless(app);