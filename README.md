# reminders-platform

CleverVA Reminders — a small self-hosted scheduler for client reminders. Create a
reminder from a web dashboard, pick when it should go out, and it is delivered on
time via **Slack DM** or **email**. Delivery runs through the Zapier SDK, so there
are no per-channel API integrations to maintain.

## How it works

Reminders are stored in a local SQLite file. A scheduler ticks every 30 seconds,
picks up anything now due and still `pending`, sends it, and marks the row `sent`
or `failed`. Nothing is sent twice — status is updated in the same pass.

## Requirements

- Node.js 20.6 or newer (the start script uses `--env-file`)
- A Zapier account with the Slack and Gmail connections you intend to use

## Setup

```bash
npm install
```

Create `CleverVA/.env` with the values for your own Zapier connections:

```
SLACK_USER_TOKEN=<your-slack-user-token>
GMAIL_CONNECTION_ID=<your-gmail-connection-id>
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `SLACK_USER_TOKEN` | for Slack delivery | Reads the workspace user list and sends DMs |
| `GMAIL_CONNECTION_ID` | for email delivery | Zapier Gmail connection used to send. No default — email sending throws if unset |
| `PORT` | no | Dashboard port, defaults to `4321` |

`.env` and the SQLite database are gitignored and never committed.

## Running

```bash
npm start    # dashboard at http://localhost:4321
npm test     # 37 tests, no network or credentials needed
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/reminders` | Create a reminder |
| `GET` | `/api/reminders` | List all reminders |
| `PATCH` | `/api/reminders/:id` | Edit a pending reminder |
| `DELETE` | `/api/reminders/:id` | Remove a reminder |
| `GET` | `/api/slack-users` | Workspace users for the recipient dropdown (cached) |

Create one:

```bash
curl -X POST http://localhost:4321/api/reminders \
  -H 'content-type: application/json' \
  -d '{"client_name":"Sarah","message":"Send the invoice","send_at":"2030-01-01T09:00:00.000Z","channel":"gmail","email":"someone@example.com"}'
```

## Layout

```
CleverVA/
  index.ts         entry point — wires db, server, scheduler
  server.ts        Express routes
  scheduler.ts     30s tick, sends what is due
  dispatch.ts      routes a reminder to the right channel
  slack.ts         Slack DM sender
  slack-users.ts   cached workspace user lookup
  gmail.ts         Gmail sender
  db.ts            SQLite store and migrations
  public/          dashboard UI
docs/superpowers/  design specs and implementation plans
```

Tests sit beside the code they cover as `*.test.ts` and run on the built-in
Node test runner.

## Notes

The `reminders` table carries a `phone` column, but SMS is not implemented —
`channel` currently accepts only `slack` and `gmail`.
