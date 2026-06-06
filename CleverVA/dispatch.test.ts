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
