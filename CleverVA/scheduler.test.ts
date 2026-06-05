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
