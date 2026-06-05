import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";
import { startScheduler } from "./scheduler.ts";
import { zapierSlackSender } from "./slack.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);

const db = openDb(path.join(here, "reminders.db"));
const app = createServer(db);
startScheduler(db, zapierSlackSender);

app.listen(PORT, () => {
  console.log(`Clever VA Reminders running at http://localhost:${PORT}`);
});
