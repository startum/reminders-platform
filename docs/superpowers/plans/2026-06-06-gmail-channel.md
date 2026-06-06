# Email (Gmail) Delivery Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each reminder be delivered via either Slack or Email (Gmail), chosen on the form, with email sent through the existing Zapier Gmail connection from info@deborahbutler.me.

**Architecture:** Add `channel` + `email` columns to the reminders table (additive migration). A new `gmail.ts` sender posts via the Zapier Gmail `message` action. A small `dispatch.ts` routes each reminder to the right sender by `channel`; the scheduler becomes channel-agnostic by taking a `send(reminder)` function. The form gains a Slack/Email toggle.

**Tech Stack:** TypeScript, tsx (`node:test`), Express 5, better-sqlite3, `@zapier/zapier-sdk`.

**Notes:**
- Work from repo root `/Users/deborahbutler/Documents/Zapier`. Tests: `npx tsx --test CleverVA/<file>.test.ts`; full suite: `npm test`.
- Local imports use explicit `.ts` extensions.
- Confirmed live (read-only): Gmail send = `runAction({app:"gmail", actionType:"write", action:"message", connectionId, inputs:{to,subject,body,body_type}})`. Connection for info@deborahbutler.me = `<your-gmail-connection-id>`.
- `zapier.runAction` THROWS on action failure (e.g. the earlier Slack `channel_not_found`), so senders need no extra ok-check.
- git repo on master. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- The frontend (`public/`) was redesigned by the user and is uncommitted. The frontend task READS the current files and integrates; do not assume the original markup.

---

### Task 1: Data model — channel + email columns (`db.ts`)

**Files:**
- Modify: `CleverVA/db.ts`
- Test: `CleverVA/db.test.ts`

- [ ] **Step 1: Add failing tests** — append to `CleverVA/db.test.ts`:
```ts
import Database from "better-sqlite3";
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
// (openDb is already imported at the top of this file)

test("create defaults channel to slack and email to null", () => {
  const db = openDb(":memory:");
  const r = db.create({ client_name: "Acme", slack_target: "U1", message: "hi", send_at: "2026-06-07T09:00:00.000Z" }, "2026-06-06T12:00:00.000Z");
  assert.equal(r.channel, "slack");
  assert.equal(r.email, null);
  db.close();
});

test("create persists a gmail reminder with email and empty slack_target", () => {
  const db = openDb(":memory:");
  const r = db.create(
    { client_name: "Acme", slack_target: "", message: "hi", send_at: "2026-06-07T09:00:00.000Z", channel: "gmail", email: "x@y.com" },
    "2026-06-06T12:00:00.000Z",
  );
  assert.equal(r.channel, "gmail");
  assert.equal(r.email, "x@y.com");
  assert.equal(r.slack_target, "");
  const pending = db.listPending();
  assert.equal(pending[0].channel, "gmail");
  assert.equal(pending[0].email, "x@y.com");
  db.close();
});

test("openDb migrates an old-schema database by adding channel and email", () => {
  const file = path.join(os.tmpdir(), `cva-migrate-${process.pid}.db`);
  fs.rmSync(file, { force: true });
  // Build an OLD-schema table (no channel/email) with one row.
  const raw = new Database(file);
  raw.exec(`CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL, slack_target TEXT NOT NULL, message TEXT NOT NULL,
    send_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, sent_at TEXT, error TEXT
  );`);
  raw.prepare(`INSERT INTO reminders (client_name, slack_target, message, send_at, status, created_at) VALUES (?,?,?,?,'pending',?)`)
     .run("Old", "U9", "legacy", "2026-06-07T09:00:00.000Z", "2026-06-06T12:00:00.000Z");
  raw.close();

  const db = openDb(file); // should ALTER TABLE ADD COLUMN channel/email
  const row = db.listPending()[0];
  assert.equal(row.channel, "slack");
  assert.equal(row.email, null);
  db.close();
  fs.rmSync(file, { force: true });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx tsx --test CleverVA/db.test.ts` → new tests fail (channel/email undefined; no migration).

- [ ] **Step 3: Implement in `db.ts`.**

(a) In the `CREATE TABLE IF NOT EXISTS reminders (...)` block, add two columns — put `channel` right after `send_at` and `email` after `status` (anywhere in the column list is fine):
```sql
      send_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'slack' CHECK(channel IN ('slack','gmail')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      email TEXT,
```

(b) Immediately AFTER the `db.exec(\`CREATE TABLE ...\`)` call, add the migration for pre-existing databases:
```ts
  const cols = (db.prepare("PRAGMA table_info(reminders)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("channel")) {
    db.exec("ALTER TABLE reminders ADD COLUMN channel TEXT NOT NULL DEFAULT 'slack'");
  }
  if (!cols.includes("email")) {
    db.exec("ALTER TABLE reminders ADD COLUMN email TEXT");
  }
```

(c) Update the interfaces:
```ts
export interface Reminder {
  id: number;
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel: "slack" | "gmail";
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  email: string | null;
  error: string | null;
}

export interface NewReminder {
  client_name: string;
  slack_target: string;
  message: string;
  send_at: string;
  channel?: "slack" | "gmail";
  email?: string | null;
}
```

(d) Update `create` to persist channel + email (default channel `'slack'`, email `null`):
```ts
    create(r: NewReminder, now: string): Reminder {
      const info = db
        .prepare(
          `INSERT INTO reminders (client_name, slack_target, message, send_at, channel, email, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(r.client_name, r.slack_target, r.message, r.send_at, r.channel ?? "slack", r.email ?? null, now);
      return get(Number(info.lastInsertRowid))!;
    },
```

`listPending`/`listDue`/`listSent`/`get` use `SELECT *`, so they return the new columns with no query change.

- [ ] **Step 4: Run, confirm PASS** — `npx tsx --test CleverVA/db.test.ts` → all pass (10 original + 3 new = 13).

- [ ] **Step 5: Commit**
```bash
git add CleverVA/db.ts CleverVA/db.test.ts
git commit -m "feat: add channel and email columns to reminders"
```

---

### Task 2: Gmail sender (`gmail.ts`)

**Files:**
- Create: `CleverVA/gmail.ts`
- Test: `CleverVA/gmail.test.ts`

- [ ] **Step 1: Write the failing test** — create `CleverVA/gmail.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGmailInputs } from "./gmail.ts";

test("buildGmailInputs maps to/subject/body and forces plain text", () => {
  assert.deepEqual(buildGmailInputs("a@b.com", "Reminder: Sarah", "Take meds"), {
    to: "a@b.com",
    subject: "Reminder: Sarah",
    body: "Take meds",
    body_type: "plain",
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx tsx --test CleverVA/gmail.test.ts` → cannot find module.

- [ ] **Step 3: Implement `CleverVA/gmail.ts`:**
```ts
import { createZapierSdk } from "@zapier/zapier-sdk";

// info@deborahbutler.me Gmail connection (override with GMAIL_CONNECTION_ID).
const DEFAULT_GMAIL_CONNECTION_ID = "<your-gmail-connection-id>";

/** Sends a plain-text email. Throws on failure. */
export type GmailSender = (to: string, subject: string, body: string) => Promise<void>;

/** Pure builder for the Zapier Gmail `message` action inputs. */
export function buildGmailInputs(to: string, subject: string, body: string) {
  return { to, subject, body, body_type: "plain" };
}

export const zapierGmailSender: GmailSender = async (to, subject, body) => {
  const zapier = createZapierSdk();
  const connectionId = process.env.GMAIL_CONNECTION_ID || DEFAULT_GMAIL_CONNECTION_ID;
  await zapier.runAction({
    app: "gmail",
    actionType: "write",
    action: "message",
    connectionId,
    inputs: buildGmailInputs(to, subject, body),
  });
};
```

- [ ] **Step 4: Run, confirm PASS** — `npx tsx --test CleverVA/gmail.test.ts` → 1 pass.

- [ ] **Step 5: Commit**
```bash
git add CleverVA/gmail.ts CleverVA/gmail.test.ts
git commit -m "feat: Zapier Gmail sender"
```

---

### Task 3: Channel dispatch + scheduler refactor (`dispatch.ts`, `scheduler.ts`)

**Files:**
- Create: `CleverVA/dispatch.ts`
- Test: `CleverVA/dispatch.test.ts`
- Modify: `CleverVA/scheduler.ts`
- Modify: `CleverVA/scheduler.test.ts`

- [ ] **Step 1: Write the failing dispatch test** — create `CleverVA/dispatch.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReminderSender } from "./dispatch.ts";

function reminder(over = {}) {
  return {
    id: 1, client_name: "Sarah", slack_target: "U1", message: "Take meds",
    send_at: "2026-06-07T09:00:00.000Z", channel: "slack", status: "pending",
    created_at: "", sent_at: null, email: null, error: null, ...over,
  };
}

test("routes a slack reminder to the slack sender", async () => {
  const calls = [];
  const send = createReminderSender({
    slack: async (target, text) => { calls.push(["slack", target, text]); },
    gmail: async () => { throw new Error("should not call gmail"); },
  });
  await send(reminder());
  assert.deepEqual(calls, [["slack", "U1", "Take meds"]]);
});

test("routes a gmail reminder to the gmail sender with auto subject", async () => {
  const calls = [];
  const send = createReminderSender({
    slack: async () => { throw new Error("should not call slack"); },
    gmail: async (to, subject, body) => { calls.push(["gmail", to, subject, body]); },
  });
  await send(reminder({ channel: "gmail", slack_target: "", email: "a@b.com" }));
  assert.deepEqual(calls, [["gmail", "a@b.com", "Reminder: Sarah", "Take meds"]]);
});

test("throws when a gmail reminder has no email", async () => {
  const send = createReminderSender({ slack: async () => {}, gmail: async () => {} });
  await assert.rejects(() => send(reminder({ channel: "gmail", email: null })), /no email/i);
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx tsx --test CleverVA/dispatch.test.ts` → cannot find module.

- [ ] **Step 3: Implement `CleverVA/dispatch.ts`:**
```ts
import type { Reminder } from "./db.ts";
import type { SlackSender } from "./slack.ts";
import type { GmailSender } from "./gmail.ts";

export type ReminderSend = (r: Reminder) => Promise<void>;

/** Routes a reminder to the correct channel sender. */
export function createReminderSender(senders: { slack: SlackSender; gmail: GmailSender }): ReminderSend {
  return async (r: Reminder): Promise<void> => {
    if (r.channel === "gmail") {
      if (!r.email) throw new Error(`gmail reminder ${r.id} has no email`);
      await senders.gmail(r.email, `Reminder: ${r.client_name}`, r.message);
      return;
    }
    await senders.slack(r.slack_target, r.message);
  };
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx tsx --test CleverVA/dispatch.test.ts` → 3 pass.

- [ ] **Step 5: Refactor `scheduler.ts` to be channel-agnostic.** Replace its full contents with:
```ts
import type { Store } from "./db.ts";
import type { ReminderSend } from "./dispatch.ts";

export interface ProcessResult {
  sent: number;
  failed: number;
}

/** Sends every pending reminder due at or before `now`. Each is processed independently. */
export async function processDue(db: Store, send: ReminderSend, now: string): Promise<ProcessResult> {
  const due = db.listDue(now);
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    try {
      await send(r);
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
export function startScheduler(db: Store, send: ReminderSend, intervalMs = 30_000): NodeJS.Timeout {
  const tick = () => {
    processDue(db, send, new Date().toISOString()).catch((err) => console.error("scheduler tick failed:", err));
  };
  tick();
  return setInterval(tick, intervalMs);
}
```

- [ ] **Step 6: Update `scheduler.test.ts`** so the fake is a `send(reminder)` function. Replace each fake sender. Specifically:
  - The success fake becomes: `const calls = []; const send = async (r) => { calls.push(r); };` and the assertion checks `calls[0].client_name === "Due"` (instead of `calls` being `[[target,text]]`). Concretely, replace the body of the first test's sender/assertions:
```ts
test("processDue sends only due reminders and marks them sent", async () => {
  const db = seed();
  const calls = [];
  const send = async (r) => { calls.push(r); };

  const result = await processDue(db, send, NOW);

  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].client_name, "Due");
  assert.equal(db.listPending().length, 1);
  assert.equal(db.listSent()[0].client_name, "Due");
  db.close();
});
```
  - The failure test: `const send = async () => { throw new Error("slack down"); };` then `await processDue(db, send, NOW)` — keep the rest of its assertions.
  - The no-op test: `await processDue(db, async () => {}, "2026-06-05T10:00:00.000Z")` — unchanged shape.

- [ ] **Step 7: Run, confirm PASS** — `npx tsx --test CleverVA/scheduler.test.ts` → 3 pass.

- [ ] **Step 8: Commit**
```bash
git add CleverVA/dispatch.ts CleverVA/dispatch.test.ts CleverVA/scheduler.ts CleverVA/scheduler.test.ts
git commit -m "feat: channel dispatch and channel-agnostic scheduler"
```

---

### Task 4: API — accept channel + email (`server.ts`)

**Files:**
- Modify: `CleverVA/server.ts`
- Modify: `CleverVA/server.test.ts`

- [ ] **Step 1: Add failing tests** — append to `CleverVA/server.test.ts` (the `withServer`/`valid` helpers already exist):
```ts
test("POST a gmail reminder with a valid email persists channel+email", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, channel: "gmail", email: "client@example.com", slack_target: undefined }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.channel, "gmail");
    assert.equal(body.email, "client@example.com");

    const pending = await (await fetch(`${base}/api/reminders?status=pending`)).json();
    assert.equal(pending[0].channel, "gmail");
    assert.equal(pending[0].email, "client@example.com");
  });
});

test("POST a gmail reminder with an invalid email returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, channel: "gmail", email: "not-an-email" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST with an unknown channel returns 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, channel: "carrier-pigeon" }),
    });
    assert.equal(res.status, 400);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx tsx --test CleverVA/server.test.ts` → new tests fail.

- [ ] **Step 3: Implement** the `POST /api/reminders` handler in `server.ts`. Replace the existing handler body with:
```ts
  app.post("/api/reminders", (req, res) => {
    const { client_name, slack_target, message, send_at, channel: rawChannel, email } = req.body ?? {};
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
    if (channel === "slack") {
      if (typeof slack_target !== "string" || slack_target.trim().length === 0) {
        res.status(400).json({ error: "slack_target is required for a Slack reminder" });
        return;
      }
      target = slack_target.trim();
    } else {
      const e = typeof email === "string" ? email.trim() : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        res.status(400).json({ error: "a valid email is required for an email reminder" });
        return;
      }
      emailVal = e;
    }

    const reminder = db.create(
      {
        client_name: client_name.trim(),
        slack_target: target,
        message: message.trim(),
        send_at: new Date(parsed).toISOString(),
        channel,
        email: emailVal,
      },
      new Date().toISOString(),
    );
    res.status(201).json(reminder);
  });
```

- [ ] **Step 4: Run, confirm PASS** — `npx tsx --test CleverVA/server.test.ts` → all pass (8 existing + 3 new = 11). The existing slack tests still pass because `channel` defaults to `slack`.

- [ ] **Step 5: Commit**
```bash
git add CleverVA/server.ts CleverVA/server.test.ts
git commit -m "feat: API accepts channel and email for reminders"
```

---

### Task 5: Wire Gmail into the entry point (`index.ts`, `.env`)

**Files:**
- Modify: `CleverVA/index.ts`
- Modify: `CleverVA/.env` (gitignored — not committed)

- [ ] **Step 1: Update `CleverVA/index.ts`** to build the dispatcher and pass it to the scheduler. Replace its contents with:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";
import { startScheduler } from "./scheduler.ts";
import { zapierSlackSender } from "./slack.ts";
import { zapierGmailSender } from "./gmail.ts";
import { createReminderSender } from "./dispatch.ts";
import { createSlackUserCache, fetchSlackUsers } from "./slack-users.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);

const db = openDb(path.join(here, "reminders.db"));
const slackUsers = createSlackUserCache(fetchSlackUsers);
const send = createReminderSender({ slack: zapierSlackSender, gmail: zapierGmailSender });
const app = createServer(db, slackUsers);
startScheduler(db, send);

app.listen(PORT, () => {
  console.log(`Clever VA Reminders running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Add `GMAIL_CONNECTION_ID` to `CleverVA/.env`** (so it's explicit/configurable; code already defaults to this value). Append this line to the existing `.env` (keep the existing `SLACK_USER_TOKEN` line):
```
GMAIL_CONNECTION_ID=<your-gmail-connection-id>
```

- [ ] **Step 3: Full suite** — `npm test` → everything green (db 13 + gmail 1 + dispatch 3 + scheduler 3 + server 11 + slack-users 9 = 40).

- [ ] **Step 4: Commit** (index.ts only — `.env` is gitignored):
```bash
git add CleverVA/index.ts
git commit -m "feat: wire Gmail sender into scheduler dispatch"
```

---

### Task 6: Form channel toggle (`public/`)

**Files:**
- Modify: `CleverVA/public/index.html`
- Modify: `CleverVA/public/app.js`
- Modify: `CleverVA/public/styles.css`

IMPORTANT: READ the current `index.html` and `app.js` first — the form was redesigned. Integrate, matching the existing `.field-group` / class style. Key existing ids: form `#reminder-form`, client `#client_name`, Slack select `#slack-target` (inside a `.field-group`), message `#message`, submit builds `data` via `Object.fromEntries(new FormData(form))` and already deletes `schedule_preset` and sets `data.send_at`. There is a live preview with `#preview-recipient`.

- [ ] **Step 1: Add a channel toggle + email field to `index.html`.** Immediately BEFORE the existing Slack Person `.field-group` (the one containing `<select ... id="slack-target">`), insert:
```html
              <div class="field-group">
                <label>
                  <i data-lucide="send" class="label-icon"></i> Send via
                </label>
                <div class="channel-toggle">
                  <label class="channel-option">
                    <input type="radio" name="channel" value="slack" checked /> Slack
                  </label>
                  <label class="channel-option">
                    <input type="radio" name="channel" value="gmail" /> Email
                  </label>
                </div>
              </div>
```
Then wrap the existing Slack Person `.field-group` by adding `id="slack-field"` to its opening `<div class="field-group">` tag. Immediately AFTER that Slack field-group, insert the hidden email field-group:
```html
              <div class="field-group" id="email-field" hidden>
                <label for="email">
                  <i data-lucide="mail" class="label-icon"></i> Recipient Email
                </label>
                <input id="email" name="email" type="email" placeholder="client@example.com" />
              </div>
```

- [ ] **Step 2: Wire the toggle in `app.js`.** Add this block right after the `const slackTarget = document.getElementById("slack-target");` line (near the top, where dropdown logic lives):
```js
const slackField = document.getElementById("slack-field");
const emailField = document.getElementById("email-field");
const emailInput = document.getElementById("email");

function currentChannel() {
  const checked = document.querySelector("input[name='channel']:checked");
  return checked ? checked.value : "slack";
}

function applyChannel() {
  const ch = currentChannel();
  const isGmail = ch === "gmail";
  slackField.hidden = isGmail;
  emailField.hidden = !isGmail;
  // Only the active channel's recipient field is required (so HTML5 validation passes).
  slackTarget.required = !isGmail;
  emailInput.required = isGmail;
  updatePreview();
}

document.querySelectorAll("input[name='channel']").forEach((radio) =>
  radio.addEventListener("change", applyChannel),
);
emailInput.addEventListener("input", updatePreview);
```

- [ ] **Step 3: Include channel/email on submit.** In the `form.addEventListener("submit", ...)` handler in `app.js`, the line that builds `data` is `const data = Object.fromEntries(new FormData(form));`. `channel` and `email` are form fields, so they are already included. After the existing `data.send_at = ...` resolution and before the `fetch`, add a guard so a hidden field isn't sent stale:
```js
  if (data.channel === "gmail") {
    data.slack_target = "";
  } else {
    data.email = "";
  }
```
(The server ignores the empty non-active field. No other change to the submit handler.)

- [ ] **Step 4: Show the recipient correctly in the live preview.** In `updatePreview()` in `app.js`, the recipient is currently derived from the Slack select. Replace the recipient-resolution lines so it reflects the active channel:
```js
  let recipientVal = "";
  if (currentChannel() === "gmail") {
    recipientVal = emailInput.value.trim();
  } else {
    const slackOpt = slackTarget.options[slackTarget.selectedIndex];
    recipientVal = slackOpt && slackOpt.value ? `@${slackOpt.text}` : "";
  }
```
Then set the recipient preview element to `recipientVal` (keep the existing `set(recipientEl, recipientVal)` call; remove the earlier `@`-prefixing of the slack name if it now double-prefixes — ensure the gmail branch shows the raw email and the slack branch shows `@Name`).

- [ ] **Step 5: Call `applyChannel()` on load.** At the very bottom of `app.js`, after the existing `loadPeople();` call, add:
```js
applyChannel();
```

- [ ] **Step 6: Style the toggle in `styles.css`.** Append:
```css
.channel-toggle { display: flex; gap: 16px; }
.channel-option { display: flex; align-items: center; gap: 6px; cursor: pointer; }
#email-field[hidden] { display: none; }
#slack-field[hidden] { display: none; }
```

- [ ] **Step 7: Syntax-check** — `node --check CleverVA/public/app.js` → no output.

- [ ] **Step 8: Commit**
```bash
git add CleverVA/public
git commit -m "feat: Slack/Email channel toggle on the reminder form"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — `npm test` → 40 tests green, clean exit.

- [ ] **Step 2: Boot and check the API + DB (no email sent yet).** Restart cleanly:
```bash
pkill -f "CleverVA/index.ts"; sleep 1
npm start &
sleep 3
```
Confirm the boot log shows the running message. Then:
- `curl -s http://localhost:4321/ | grep -c 'name="channel"'` → confirm the channel toggle is in the served HTML (≥1).
- POST a gmail reminder dated far in the FUTURE (so the scheduler won't send it) and confirm 201 + channel/email persisted:
  `curl -s -X POST http://localhost:4321/api/reminders -H 'content-type: application/json' -d '{"client_name":"Self Test","message":"email channel check","send_at":"2030-01-01T09:00:00.000Z","channel":"gmail","email":"info@deborahbutler.me"}'`
  → confirm JSON has `"channel":"gmail"` and `"email":"info@deborahbutler.me"`.
- Cancel it: `DELETE /api/reminders/<id>` → 204 (so it never sends).

- [ ] **Step 3: One real email test (USER-AUTHORIZED).** Because this sends a real email, do this only with the user's go-ahead, and send to the user's own address. Schedule a gmail reminder ~1–2 minutes out to `info@deborahbutler.me` from the dashboard (http://localhost:4321), then confirm: the email arrives from info@deborahbutler.me with subject `Reminder: <client>`, and the reminder moves to **Sent**. If it lands in **Sent** as *failed*, read the error and adjust `GMAIL_CONNECTION_ID` in `.env` (see spec Risks).

- [ ] **Step 4: Report** full-suite result, the API/DB checks, and the live email outcome (or note it was deferred to the user).

---

## Self-Review

**Spec coverage:**
- One channel per reminder → `channel` column + dispatch + toggle. ✓
- Gmail via Zapier `message` action from info@deborahbutler.me → `gmail.ts` (Task 2), connection id + env. ✓
- Auto subject `"Reminder: <client_name>"`, message = body → dispatch (Task 3) + buildGmailInputs (Task 2). ✓
- Free-text recipient email → `email` field (Task 6) + server validation (Task 4). ✓
- Additive data model + migration → Task 1 (incl. migration test). ✓
- Channel-agnostic scheduler → Task 3. ✓
- API branch validation, 400s → Task 4. ✓
- Frontend toggle + conditional fields → Task 6 (reads current redesigned files). ✓
- Live email risk/verification → Task 7. ✓

**Placeholder scan:** No TBD/TODO; all code steps contain complete code. Frontend task intentionally instructs reading current files (they're user-modified) but gives exact snippets to insert.

**Type consistency:** `Reminder` (with `channel`/`email`), `NewReminder` (optional `channel`/`email`), `SlackSender(target,text)`, `GmailSender(to,subject,body)`, `ReminderSend(r)`, `createReminderSender({slack,gmail})`, `buildGmailInputs(to,subject,body)`, `processDue(db,send,now)`, `startScheduler(db,send)` — names/signatures match across db, gmail, dispatch, scheduler, server, index, and tests. `createServer(db, slackUsers)` is unchanged (dispatch is wired at the scheduler, not the server). ✓
