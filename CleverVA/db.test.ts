import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.ts";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

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
  assert.equal(db.listPending().length, 1);
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

  const db = openDb(file);
  const row = db.listPending()[0];
  assert.equal(row.channel, "slack");
  assert.equal(row.email, null);
  db.close();
  fs.rmSync(file, { force: true });
});
