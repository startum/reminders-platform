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
