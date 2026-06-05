# Clever VA Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user web dashboard that schedules Slack DMs and delivers them automatically at their scheduled time.

**Architecture:** One Node/Express process serves a vanilla-JS 3-tab dashboard, exposes a JSON API, owns a SQLite store, and runs an in-process scheduler loop that sends due reminders through the Zapier Slack SDK. The Slack send is injected as a `SlackSender` function so the scheduler is unit-testable with a fake.

**Tech Stack:** TypeScript, tsx (runner + `node:test`), Express, better-sqlite3, `@zapier/zapier-sdk` (already installed).

**Notes:**
- All app source lives under `CleverVA/`. Dependencies are added to the repo-root `package.json` (`/Users/deborahbutler/Documents/Zapier/package.json`); Node resolves them from the root `node_modules`.
- This project is **not** a git repo yet. Task 1 initializes git so the commit steps work. All paths in commands are relative to the repo root `/Users/deborahbutler/Documents/Zapier`.
- Tests use `node:test` run via tsx: `npx tsx --test <file>`. SQLite tests use an in-memory db (`:memory:`).

---

### Task 1: Project setup — git, dependencies, scripts

**Files:**
- Modify: `package.json`
- Create: `CleverVA/.gitignore`

- [ ] **Step 1: Initialize git**

Run:
```bash
git init
```
Expected: "Initialized empty Git repository ...".

- [ ] **Step 2: Install runtime + dev dependencies**

Run:
```bash
npm install express better-sqlite3
npm install -D @types/express @types/better-sqlite3
```
Expected: packages added, no errors.

- [ ] **Step 3: Add scripts to `package.json`**

In `package.json`, replace the `"scripts"` block with:
```json
  "scripts": {
    "start": "tsx CleverVA/index.ts",
    "test": "tsx --test CleverVA/*.test.ts"
  },
```

- [ ] **Step 4: Create `CleverVA/.gitignore`**

```
node_modules/
reminders.db
*.db
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Clever VA Reminders project"
```

---

### Task 2: Data layer (`db.ts`)

**Files:**
- Create: `CleverVA/db.ts`
- Test: `CleverVA/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `CleverVA/db.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.ts";

const NOW = "2026-06-05T12:00:00.000Z";

function seed() {
  const db = openDb(":memory:");
  db.create({ client_name: "Acme", slack_target: "U1", message: "later", send_at: "2026-06-06T09:00:00.000Z" }, NOW);
  db.create({ client_name: "Beta", slack_target: "U2", message: "due now", send_at: "2026-06-05T11:00:00.000Z" }, NOW);
  return db;
}

test("create returns a pending reminder with an id", () => {
  const db = openDb(":memory:");
  const r = db.create({ client_name: "Acme", slack_target: "U1", message: "hi", send_at: "2026-06-06T09:00:00.000Z" }, NOW);
  assert.ok(r.id > 0);
  assert.equal(r.status, "pending");
  assert.equal(r.created_at, NOW);
  assert.equal(r.sent_at, null);
  db.close();
});

test("listPending is sorted by send_at ascending", () => {
  const db = seed();
  const pending = db.listPending();
  assert.deepEqual(pending.map((r) => r.client_name), ["Beta", "Acme"]);
  db.close();
});

test("listDue returns only pending reminders due at or before now", () => {
  const db = seed();
  const due = db.listDue(NOW);
  assert.deepEqual(due.map((r) => r.client_name), ["Beta"]);
  db.close();
});

test("markSent moves a reminder into the sent log", () => {
  const db = seed();
  const due = db.listDue(NOW)[0];
  db.markSent(due.id, NOW);
  const sent = db.listSent();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, "sent");
  assert.equal(sent[0].sent_at, NOW);
  assert.equal(db.listPending().length, 1);
  db.close();
});

test("markFailed records the error and shows in sent log", () => {
  const db = seed();
  const due = db.listDue(NOW)[0];
  db.markFailed(due.id, "boom", NOW);
  const sent = db.listSent();
  assert.equal(sent[0].status, "failed");
  assert.equal(sent[0].error, "boom");
  db.close();
});

test("listSent is sorted by sent_at descending", () => {
  const db = seed();
  const [a, b] = db.listPending();
  db.markSent(a.id, "2026-06-05T11:30:00.000Z");
  db.markSent(b.id, "2026-06-05T12:30:00.000Z");
  const sent = db.listSent();
  assert.deepEqual(sent.map((r) => r.sent_at), ["2026-06-05T12:30:00.000Z", "2026-06-05T11:30:00.000Z"]);
  db.close();
});

test("cancel deletes a pending reminder and returns true; false when missing", () => {
  const db = seed();
  const id = db.listPending()[0].id;
  assert.equal(db.cancel(id), true);
  assert.equal(db.cancel(999999), false);
  assert.equal(db.listPending().length, 1);
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test CleverVA/db.test.ts`
Expected: FAIL — cannot find module `./db.ts`.

- [ ] **Step 3: Implement `db.ts`**

Create `CleverVA/db.ts`:
```ts
import Database from "better-sqlite3";

export type ReminderStatus = "pending" | "sent" | "failed";

export interface Reminder {
  id: number;
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  error: string | null;
}

export interface NewReminder {
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
}

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      slack_target TEXT NOT NULL,
      message TEXT NOT NULL,
      send_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      error TEXT
    );
  `);

  return {
    create(r: NewReminder, now: string): Reminder {
      const info = db
        .prepare(
          `INSERT INTO reminders (client_name, slack_target, message, send_at, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(r.client_name, r.slack_target, r.message, r.send_at, now);
      return this.get(Number(info.lastInsertRowid))!;
    },

    get(id: number): Reminder | undefined {
      return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as Reminder | undefined;
    },

    listPending(): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status = 'pending' ORDER BY send_at ASC`)
        .all() as Reminder[];
    },

    listDue(now: string): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC`)
        .all(now) as Reminder[];
    },

    listSent(): Reminder[] {
      return db
        .prepare(`SELECT * FROM reminders WHERE status IN ('sent', 'failed') ORDER BY sent_at DESC`)
        .all() as Reminder[];
    },

    markSent(id: number, sentAt: string): void {
      db.prepare(`UPDATE reminders SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`).run(sentAt, id);
    },

    markFailed(id: number, error: string, sentAt: string): void {
      db.prepare(`UPDATE reminders SET status = 'failed', sent_at = ?, error = ? WHERE id = ?`).run(sentAt, error, id);
    },

    cancel(id: number): boolean {
      const info = db.prepare(`DELETE FROM reminders WHERE id = ? AND status = 'pending'`).run(id);
      return info.changes > 0;
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openDb>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test CleverVA/db.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add CleverVA/db.ts CleverVA/db.test.ts
git commit -m "feat: SQLite data layer for reminders"
```

---

### Task 3: Slack sender wrapper (`slack.ts`)

**Files:**
- Create: `CleverVA/slack.ts`

(No unit test: this calls the live Zapier SDK. It is exercised manually in Task 6 and via the injected fake in Task 4.)

- [ ] **Step 1: Implement `slack.ts`**

Create `CleverVA/slack.ts`:
```ts
import { createZapierSdk } from "@zapier/zapier-sdk";

// Reused from src/zapier-slack-test.ts
const CONNECTION_ID = "02687b2e-345c-860b-9d27-533f33afee39";

/** Sends `text` to a Slack member id `target`. Throws on failure. */
export type SlackSender = (target: string, text: string) => Promise<void>;

export const zapierSlackSender: SlackSender = async (target, text) => {
  const zapier = createZapierSdk();
  await zapier.runAction({
    app: "slack",
    actionType: "write",
    action: "direct_message",
    connectionId: CONNECTION_ID,
    inputs: { channel: target, text },
  });
};
```

- [ ] **Step 2: Type-check it compiles**

Run: `npx tsx --eval "import('./CleverVA/slack.ts').then(() => console.log('ok'))"`
Expected: prints `ok` (module imports without type/syntax errors).

- [ ] **Step 3: Commit**

```bash
git add CleverVA/slack.ts
git commit -m "feat: Zapier Slack DM sender wrapper"
```

---

### Task 4: Scheduler (`scheduler.ts`)

**Files:**
- Create: `CleverVA/scheduler.ts`
- Test: `CleverVA/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `CleverVA/scheduler.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.ts";
import { processDue } from "./scheduler.ts";

const NOW = "2026-06-05T12:00:00.000Z";

function seed() {
  const db = openDb(":memory:");
  db.create({ client_name: "Due", slack_target: "U1", message: "go", send_at: "2026-06-05T11:00:00.000Z" }, NOW);
  db.create({ client_name: "Future", slack_target: "U2", message: "wait", send_at: "2026-06-07T09:00:00.000Z" }, NOW);
  return db;
}

test("processDue sends only due reminders and marks them sent", async () => {
  const db = seed();
  const calls: Array<[string, string]> = [];
  const sender = async (target: string, text: string) => { calls.push([target, text]); };

  const result = await processDue(db, sender, NOW);

  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.deepEqual(calls, [["U1", "go"]]);
  assert.equal(db.listPending().length, 1);     // Future still pending
  assert.equal(db.listSent()[0].client_name, "Due");
  db.close();
});

test("processDue marks a reminder failed when the sender throws", async () => {
  const db = seed();
  const sender = async () => { throw new Error("slack down"); };

  const result = await processDue(db, sender, NOW);

  assert.deepEqual(result, { sent: 0, failed: 1 });
  const failed = db.listSent()[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "slack down");
  db.close();
});

test("processDue with nothing due is a no-op", async () => {
  const db = seed();
  const result = await processDue(db, async () => {}, "2026-06-05T10:00:00.000Z");
  assert.deepEqual(result, { sent: 0, failed: 0 });
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test CleverVA/scheduler.test.ts`
Expected: FAIL — cannot find module `./scheduler.ts`.

- [ ] **Step 3: Implement `scheduler.ts`**

Create `CleverVA/scheduler.ts`:
```ts
import type { Store } from "./db.ts";
import type { SlackSender } from "./slack.ts";

export interface ProcessResult {
  sent: number;
  failed: number;
}

/** Sends every pending reminder due at or before `now`. Each is processed independently. */
export async function processDue(db: Store, sender: SlackSender, now: string): Promise<ProcessResult> {
  const due = db.listDue(now);
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    try {
      await sender(r.slack_target, r.message);
      db.markSent(r.id, now);
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markFailed(r.id, message, now);
      failed++;
    }
  }
  return { sent, failed };
}

/** Starts a repeating loop that processes due reminders. Returns the interval handle. */
export function startScheduler(db: Store, sender: SlackSender, intervalMs = 30_000): NodeJS.Timeout {
  const tick = () => {
    processDue(db, sender, new Date().toISOString()).catch((err) => console.error("scheduler tick failed:", err));
  };
  tick();
  return setInterval(tick, intervalMs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test CleverVA/scheduler.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add CleverVA/scheduler.ts CleverVA/scheduler.test.ts
git commit -m "feat: reminder scheduler with injectable sender"
```

---

### Task 5: HTTP API (`server.ts`)

**Files:**
- Create: `CleverVA/server.ts`
- Test: `CleverVA/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `CleverVA/server.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";

async function withServer(fn: (base: string) => Promise<void>) {
  const db = openDb(":memory:");
  const server = createServer(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    db.close();
  }
}

const valid = {
  client_name: "Acme",
  slack_target: "U1",
  message: "ping",
  send_at: "2026-06-06T09:00:00.000Z",
};

test("POST creates a reminder and it appears in pending", async () => {
  await withServer(async (base) => {
    const post = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    });
    assert.equal(post.status, 201);

    const list = await (await fetch(`${base}/api/reminders?status=pending`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].client_name, "Acme");
  });
});

test("POST with a missing field returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, message: "" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST with an unparseable send_at returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, send_at: "not-a-date" }),
    });
    assert.equal(res.status, 400);
  });
});

test("DELETE cancels a pending reminder", async () => {
  await withServer(async (base) => {
    const created = await (
      await fetch(`${base}/api/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid),
      })
    ).json();

    const del = await fetch(`${base}/api/reminders/${created.id}`, { method: "DELETE" });
    assert.equal(del.status, 204);

    const list = await (await fetch(`${base}/api/reminders?status=pending`)).json();
    assert.equal(list.length, 0);
  });
});

test("DELETE of a missing id returns 404", async () => {
  await withServer(async (base) => {
    const del = await fetch(`${base}/api/reminders/999999`, { method: "DELETE" });
    assert.equal(del.status, 404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test CleverVA/server.test.ts`
Expected: FAIL — cannot find module `./server.ts`.

- [ ] **Step 3: Implement `server.ts`**

Create `CleverVA/server.ts`:
```ts
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
      return res.status(400).json({ error: "client_name, slack_target, message and send_at are all required" });
    }
    const parsed = Date.parse(send_at);
    if (Number.isNaN(parsed)) {
      return res.status(400).json({ error: "send_at is not a valid date/time" });
    }
    const reminder = db.create(
      { client_name, slack_target, message, send_at: new Date(parsed).toISOString() },
      new Date().toISOString(),
    );
    res.status(201).json(reminder);
  });

  app.get("/api/reminders", (req, res) => {
    if (req.query.status === "sent") {
      return res.json(db.listSent());
    }
    res.json(db.listPending());
  });

  app.delete("/api/reminders/:id", (req, res) => {
    const ok = db.cancel(Number(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test CleverVA/server.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add CleverVA/server.ts CleverVA/server.test.ts
git commit -m "feat: reminders HTTP API"
```

---

### Task 6: Frontend dashboard (`public/`)

**Files:**
- Create: `CleverVA/public/index.html`
- Create: `CleverVA/public/styles.css`
- Create: `CleverVA/public/app.js`

(Verified manually via the running app in Task 7. No automated test.)

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clever VA Reminders</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header><h1>Clever VA Reminders</h1></header>

    <nav class="tabs">
      <button class="tab active" data-tab="add">Add Reminder</button>
      <button class="tab" data-tab="upcoming">Upcoming</button>
      <button class="tab" data-tab="sent">Sent</button>
    </nav>

    <section id="add" class="panel active">
      <form id="reminder-form">
        <label>Client name <input name="client_name" required /></label>
        <label>Slack target (member ID) <input name="slack_target" placeholder="U0123456789" required /></label>
        <label>Message <textarea name="message" rows="4" required></textarea></label>
        <label>Date &amp; time <input name="send_at" type="datetime-local" required /></label>
        <button type="submit">Schedule reminder</button>
        <p id="form-msg" class="msg"></p>
      </form>
    </section>

    <section id="upcoming" class="panel">
      <ul id="upcoming-list" class="list"></ul>
      <p id="upcoming-empty" class="empty">No upcoming reminders.</p>
    </section>

    <section id="sent" class="panel">
      <ul id="sent-list" class="list"></ul>
      <p id="sent-empty" class="empty">Nothing sent yet.</p>
    </section>

    <script src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
:root { --bg: #0f1419; --panel: #1a212b; --accent: #2f81f7; --text: #e6edf3; --muted: #8b949e; --fail: #f85149; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
header { padding: 20px 24px; border-bottom: 1px solid #30363d; }
h1 { margin: 0; font-size: 20px; }
.tabs { display: flex; gap: 4px; padding: 12px 24px 0; }
.tab { background: none; border: none; color: var(--muted); padding: 10px 16px; cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.panel { display: none; padding: 24px; max-width: 640px; }
.panel.active { display: block; }
form { display: flex; flex-direction: column; gap: 14px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--muted); }
input, textarea { background: var(--panel); border: 1px solid #30363d; border-radius: 6px; color: var(--text); padding: 10px; font: inherit; }
button[type="submit"] { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 16px; cursor: pointer; font-size: 14px; align-self: flex-start; }
.msg { min-height: 18px; font-size: 13px; }
.msg.ok { color: #3fb950; } .msg.err { color: var(--fail); }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.card { background: var(--panel); border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
.card .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.card .client { font-weight: 600; }
.card .when { color: var(--muted); font-size: 13px; }
.card .message { margin: 8px 0 0; white-space: pre-wrap; }
.card .target { color: var(--muted); font-size: 12px; }
.card.failed { border-color: var(--fail); }
.card .error { color: var(--fail); font-size: 13px; margin-top: 6px; }
.cancel { background: none; border: 1px solid #30363d; color: var(--muted); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.empty { color: var(--muted); }
```

- [ ] **Step 3: Create `public/app.js`**

```js
const panels = document.querySelectorAll(".panel");
const tabs = document.querySelectorAll(".tab");

function show(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("active", p.id === name));
  if (name === "upcoming") loadUpcoming();
  if (name === "sent") loadSent();
}
tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const form = document.getElementById("reminder-form");
const formMsg = document.getElementById("form-msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  // datetime-local has no timezone; convert local wall-clock to ISO.
  data.send_at = new Date(data.send_at).toISOString();
  const res = await fetch("/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.ok) {
    form.reset();
    formMsg.textContent = "Scheduled.";
    formMsg.className = "msg ok";
    show("upcoming");
  } else {
    const body = await res.json().catch(() => ({}));
    formMsg.textContent = body.error || "Could not schedule reminder.";
    formMsg.className = "msg err";
  }
});

async function loadUpcoming() {
  const items = await (await fetch("/api/reminders?status=pending")).json();
  const list = document.getElementById("upcoming-list");
  document.getElementById("upcoming-empty").style.display = items.length ? "none" : "block";
  list.innerHTML = items
    .map(
      (r) => `
      <li class="card">
        <div class="row">
          <span class="client">${esc(r.client_name)}</span>
          <span class="when">${fmt(r.send_at)}</span>
        </div>
        <div class="target">to ${esc(r.slack_target)}</div>
        <p class="message">${esc(r.message)}</p>
        <button class="cancel" data-id="${r.id}">Cancel</button>
      </li>`,
    )
    .join("");
  list.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/reminders/${b.dataset.id}`, { method: "DELETE" });
      loadUpcoming();
    }),
  );
}

async function loadSent() {
  const items = await (await fetch("/api/reminders?status=sent")).json();
  const list = document.getElementById("sent-list");
  document.getElementById("sent-empty").style.display = items.length ? "none" : "block";
  list.innerHTML = items
    .map(
      (r) => `
      <li class="card ${r.status === "failed" ? "failed" : ""}">
        <div class="row">
          <span class="client">${esc(r.client_name)}</span>
          <span class="when">${fmt(r.sent_at)}</span>
        </div>
        <div class="target">to ${esc(r.slack_target)}</div>
        <p class="message">${esc(r.message)}</p>
        ${r.status === "failed" ? `<p class="error">Failed: ${esc(r.error || "unknown error")}</p>` : ""}
      </li>`,
    )
    .join("");
}

show("add");
```

- [ ] **Step 4: Commit**

```bash
git add CleverVA/public
git commit -m "feat: 3-tab reminders dashboard UI"
```

---

### Task 7: Wire up entry point and verify end-to-end (`index.ts`)

**Files:**
- Create: `CleverVA/index.ts`

- [ ] **Step 1: Implement `index.ts`**

Create `CleverVA/index.ts`:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";
import { startScheduler } from "./scheduler.ts";
import { zapierSlackSender } from "./slack.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const db = openDb(path.join(here, "reminders.db"));
const app = createServer(db);
startScheduler(db, zapierSlackSender);

app.listen(PORT, () => {
  console.log(`Clever VA Reminders running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all 15 tests (7 db + 3 scheduler + 5 server) green.

- [ ] **Step 3: Start the app and smoke-test the UI**

Run: `npm start`
Expected: console prints `Clever VA Reminders running at http://localhost:3000`. Open the URL, confirm all three tabs render and switch. On **Add Reminder**, schedule a reminder ~1 minute in the future with a real Slack member ID (e.g. `UTC7M3UG3`). Confirm it appears in **Upcoming**, then within ~30s of its time moves to **Sent** and the Slack DM arrives. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add CleverVA/index.ts
git commit -m "feat: app entry point wiring server + scheduler"
```

---

## Self-Review

**Spec coverage:**
- Three tabs (Add / Upcoming / Sent) → Task 6 UI + Task 5 API. ✓
- Add Reminder 4 fields → `index.html` form + POST validation. ✓
- Upcoming = unsent sorted by date → `listPending` ORDER BY `send_at` ASC. ✓
- Sent = delivered log (incl. failed) → `listSent` ORDER BY `sent_at` DESC. ✓
- Background scheduler auto-sends → Task 4 `startScheduler` + Task 7 wiring. ✓
- SQLite storage → Task 2. ✓
- Slack DM via Zapier → Task 3 reusing existing `runAction` call. ✓
- Cancel upcoming → DELETE endpoint + UI button. ✓
- Failed sends stay visible with error → `markFailed` + `failed` card styling. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code.

**Type consistency:** `Store` exported from `db.ts` and consumed by `scheduler.ts`/`server.ts`; `SlackSender` defined in `slack.ts` and consumed by `scheduler.ts`/`index.ts`. Method names (`create`, `listPending`, `listDue`, `listSent`, `markSent`, `markFailed`, `cancel`, `get`, `close`) are identical across db definition, tests, and callers. ✓
