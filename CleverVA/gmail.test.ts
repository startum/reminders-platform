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
