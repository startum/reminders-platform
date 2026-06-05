# Clever VA Reminders — Design

**Date:** 2026-06-05
**Status:** Approved

## Summary

A single-user web dashboard that schedules Slack reminders and delivers them
automatically at their scheduled time. Built on the existing Zapier SDK Slack
integration already present in `src/zapier-slack-test.ts`.

The dashboard has three tabs:

1. **Add Reminder** — create a reminder (client name, Slack target, message, date & time).
2. **Upcoming** — pending reminders sorted soonest-first, with a cancel action.
3. **Sent** — log of delivered reminders newest-first; failed sends appear flagged.

## Decisions

- **Delivery:** Background scheduler. An in-process loop checks for due reminders
  and sends them automatically — no manual send step.
- **Storage:** SQLite (`better-sqlite3`), a local `.db` file.
- **Slack target:** A Slack member ID (e.g. `UTC7M3UG3`). Messages are sent as
  direct messages via the Zapier `slack` / `direct_message` action — the same
  call used in `src/zapier-slack-test.ts`.
- **Frontend:** Single-page vanilla-JS dashboard served by the Node server. No
  build step.

## Architecture (Option A — single Express server)

One Node/Express process serves the dashboard, exposes a JSON API, owns the
SQLite store, and runs the scheduler loop in-process.

Files (under `CleverVA/`):

- `server.ts` — Express app; serves static dashboard + JSON API; starts the scheduler.
- `db.ts` — SQLite setup, `reminders` table, typed query helpers.
- `scheduler.ts` — `setInterval` loop (every 30s) that sends due, pending reminders.
- `slack.ts` — wraps the Zapier `runAction` Slack `direct_message` call.
- `public/index.html` + `public/app.js` + `public/styles.css` — the 3-tab dashboard.

## Data model

`reminders` table:

| Column        | Type    | Notes                                         |
|---------------|---------|-----------------------------------------------|
| `id`          | INTEGER | primary key, autoincrement                    |
| `client_name` | TEXT    | not null                                      |
| `slack_target`| TEXT    | not null — Slack member ID                    |
| `message`     | TEXT    | not null                                      |
| `send_at`     | TEXT    | ISO 8601 datetime, not null                   |
| `status`      | TEXT    | `pending` \| `sent` \| `failed`, default `pending` |
| `created_at`  | TEXT    | ISO 8601, set on insert                       |
| `sent_at`     | TEXT    | ISO 8601, nullable — set when delivered       |
| `error`       | TEXT    | nullable — failure reason for failed sends    |

## API

| Method & path                 | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `POST /api/reminders`         | Create a reminder (Add Reminder form).               |
| `GET /api/reminders?status=pending` | Upcoming — sorted by `send_at` ascending.      |
| `GET /api/reminders?status=sent`    | Sent log — `sent` and `failed`, by `sent_at` desc. |
| `DELETE /api/reminders/:id`   | Cancel an upcoming (pending) reminder.               |

`POST` validates that all four fields are present and `send_at` is a parseable
datetime; returns 400 otherwise.

## Tabs

1. **Add Reminder** — four fields: Client name (text), Slack target (text, Slack
   member ID), Message (textarea), Date & time (`datetime-local`). On submit,
   POSTs to the API and switches to Upcoming.
2. **Upcoming** — pending reminders, soonest-first. Each row shows client,
   target, message, scheduled time, and a Cancel button (DELETE).
3. **Sent** — delivered reminders, newest-first by `sent_at`. Shows the sent
   timestamp. Failed sends are flagged with their error so nothing silently
   disappears.

## Scheduler & error handling

Every 30 seconds the loop selects `pending` rows where `send_at <= now`. For
each, it calls the Slack wrapper. On success it sets `status = 'sent'` and
`sent_at`; on failure it sets `status = 'failed'` and records `error`. Each
reminder is processed independently so one failure does not block the rest.

## Out of scope (YAGNI)

- Editing an existing reminder (cancel + re-create instead).
- Recurring reminders.
- Multiple users / auth.
- Channel posts (DM-only for now).
