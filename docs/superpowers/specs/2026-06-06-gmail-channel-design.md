# Email (Gmail) Delivery Channel — Design

**Date:** 2026-06-06
**Status:** Approved
**Builds on:** Clever VA Reminders (Slack reminders + people dropdown)

## Summary

Add email as a second delivery channel. Each reminder is sent via **either Slack
or Email** (one channel per reminder, chosen on the form). Email is sent through
the existing Zapier Gmail connection from **info@deborahbutler.me** — no new
credentials. The subject is auto-generated as `"Reminder: <client name>"` and the
reminder message becomes the email body.

## Decisions

- **One channel per reminder:** `slack` or `gmail`.
- **Email transport:** Zapier Gmail `message` write action (resolved live):
  - `runAction({ app: "gmail", actionType: "write", action: "message", connectionId, inputs: { to, subject, body } })`
  - Connection `<your-gmail-connection-id>` (info@deborahbutler.me),
    stored in `.env` as `GMAIL_CONNECTION_ID` (configurable; code falls back to
    that id if unset).
  - Email has no "bot identity" problem — it sends from the connected account.
- **Subject:** auto `"Reminder: <client_name>"`. **Body:** the reminder message.
- **Recipient (email):** a free-text email address entered on the form when the
  Email channel is selected.

## Data model (`db.ts`) — additive migration

- Fresh DBs: `CREATE TABLE` includes
  `channel TEXT NOT NULL DEFAULT 'slack' CHECK(channel IN ('slack','gmail'))`
  and `email TEXT`.
- Existing DBs: a lightweight migration in `openDb` reads `PRAGMA table_info`
  and `ALTER TABLE reminders ADD COLUMN` for `channel` (`TEXT NOT NULL DEFAULT
  'slack'`, no CHECK — SQLite ADD COLUMN limitation; channel is validated at the
  app layer) and `email TEXT` if absent. Existing rows default to `slack`, so
  nothing breaks.
- `slack_target` stays `NOT NULL`. For gmail reminders the server stores
  `slack_target = ""` (ignored by the gmail path). The `email` column holds the
  recipient for gmail reminders, `NULL` for slack.
- `Reminder` gains `channel: "slack" | "gmail"` and `email: string | null`.
  `NewReminder` gains `channel` and optional `email`.

## New sender (`gmail.ts`)

- `export type GmailSender = (to: string, subject: string, body: string) => Promise<void>`
- `export const zapierGmailSender: GmailSender` — calls the Gmail `message`
  action via the Zapier SDK using `GMAIL_CONNECTION_ID` (env, default
  `<your-gmail-connection-id>`). Throws on a non-OK result. Not unit-tested (live SDK), matching
  the `slack.ts` convention.

## Dispatch (`dispatch.ts`)

- `export function createReminderSender({ slack, gmail }): (r: Reminder) => Promise<void>`
  - `channel === "gmail"` → `gmail(r.email!, \`Reminder: ${r.client_name}\`, r.message)`
  - otherwise → `slack(r.slack_target, r.message)`
  - Throws a clear error if a gmail reminder has no `email`.
- `scheduler.processDue` changes signature from `(db, sender(target,text), now)`
  to `(db, send(reminder), now)` — channel-agnostic. `startScheduler` and
  `index.ts` build the dispatcher and pass it. Existing scheduler tests update to
  inject a fake `send(reminder)`.

## API (`server.ts`)

- `POST /api/reminders` accepts `channel` plus the matching recipient:
  - `channel` defaults to `"slack"`; must be `slack` or `gmail` (else 400).
  - `slack`: requires non-empty `slack_target` (current behaviour).
  - `gmail`: requires a valid-looking `email` (simple regex; 400 otherwise);
    `slack_target` is stored as `""`.
  - `client_name`, `message`, `send_at` validated as today.
- `GET` responses include `channel` and `email` so the UI can show them.

## Frontend (`public/`)

(The form was recently redesigned by the user — the implementer reads the
current `index.html`/`app.js` and integrates minimally, matching existing style.)

- Add a **Slack / Email** channel toggle.
- Slack selected → show the existing people dropdown (`slack_target`).
- Email selected → show a single email-address `<input type="email">` (`email`)
  and hide the Slack dropdown.
- Submit sends `channel` plus the relevant recipient; only the active channel's
  field is required.
- Upcoming/Sent rows show the destination appropriately (Slack name vs email).

## Testing

- `db`: new DB has `channel`/`email`; create+list round-trips a `slack` and a
  `gmail` reminder; the ADD COLUMN migration is exercised by opening a DB seeded
  with the old schema and confirming columns appear with `slack` defaults.
- `gmail`: a pure payload-builder (`buildGmailInputs(to, subject, body)`) test;
  live `zapierGmailSender` untested by convention.
- `dispatch`: routes `slack` → slack fake with `(slack_target, message)`; routes
  `gmail` → gmail fake with `(email, "Reminder: <client>", message)`; throws when
  a gmail reminder lacks an email.
- `server`: gmail reminder with a bad/missing email → 400; valid gmail reminder
  persists with `channel='gmail'`, `email` set; slack path unchanged.
- Live end-to-end (one real test email, user-authorized) during verification.

## Risks

- The Gmail `message` action requires the **correct** connection id; the one
  resolved (`<your-gmail-connection-id>`) worked for field discovery. A real send test in
  verification confirms it (an earlier wrong id returned "Authorization email
  missing"). If the send fails, the reminder lands in **Sent** as *failed* with
  the Zapier error (already surfaced), and we adjust the connection id in `.env`.

## Out of scope (YAGNI)

- Sending to both channels at once; custom subjects; HTML email; CC/BCC/
  attachments; per-recipient email address book.
