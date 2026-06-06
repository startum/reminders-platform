# Edit Scheduled Reminder — Inline Design Spec

## Context

Users can currently cancel pending reminders but cannot correct mistakes or update details after scheduling. This adds inline editing directly in the Scheduled list.

---

## Feature Summary

Each pending reminder card gains an **Edit** button. Clicking it replaces the card's read-only view with a mini inline form. The user edits fields and saves. Only one card is in edit mode at a time.

---

## API

### `PATCH /api/reminders/:id`

- **Auth guard:** reminder must have `status = 'pending'`; returns 404 otherwise
- **Body:** any subset of `{ client_name, message, send_at, channel, slack_target, email }`
- **Validation:** same rules as POST — non-empty strings, valid ISO date, channel must be `'slack'` or `'gmail'`, appropriate target field for channel
- **Response:** `200` with updated `Reminder` JSON, or `400`/`404` with `{ error }` message

### DB: `update(id, fields)`

New method on the `Store` returned by `openDb()`. Runs a single parameterised `UPDATE reminders SET ... WHERE id = ? AND status = 'pending'`. Returns the refreshed row via the existing `get(id)` helper, or `undefined` if no row matched (404 case).

---

## Frontend

### Card read-only view (existing + Edit button)

```
[ Client Name ]          [ Scheduled time ]
via Slack · @person
Message text…
[ Edit ]   [ Cancel ]
```

### Card edit mode (replaces read-only content)

```
[ Client Name input          ]
[ Slack ] [ Email ]           ← channel toggle
[ Slack person dropdown  ▾ ] ← or [ email input ] depending on channel
[ Message textarea           ]
[ datetime-local input       ]
[ Save ]   [ Discard ]
```

### Behaviour rules

- Clicking **Edit** opens that card's inline form, pre-filled with current values. If another card is already in edit mode, it silently reverts to read-only (unsaved changes discarded).
- **Save** calls `PATCH /api/reminders/:id`, updates the card in-place on success, shows an inline error message on failure.
- **Discard** reverts the card to its read-only state without any API call.
- The Slack user list is reused from the existing `slackUsers` cache already loaded on page start — no extra fetch needed.
- Cancel button is hidden while a card is in edit mode.

---

## Files Changed

| File | Change |
|---|---|
| `CleverVA/db.ts` | Add `update(id, fields)` method to `Store` |
| `CleverVA/server.ts` | Add `PATCH /api/reminders/:id` route |
| `CleverVA/public/app.js` | Inline form render, edit/save/discard logic |
| `CleverVA/public/styles.css` | Styles for `.card-edit-form`, edit/save/discard buttons |

---

## Error Handling

- PATCH returns non-2xx → show error text inside the card (same `.msg.err` style as the main form), keep form open
- Network failure → same treatment

---

## Out of Scope

- Editing already-sent or failed reminders (status guard on server prevents this)
- Changing the reminder `id` or `created_at`
